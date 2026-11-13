import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizeObjectUrl } from '../../server/controls/sharepoint-external/authors'
import { authorPatches } from '../../server/controls/sharepoint-external/index'
import type { ControlModule } from '../../server/controls/types'
import { auditLog, checkItems, collectionRuns, controlSessions, notifications, remediations, users } from '../../server/db/schema'
import { assignItems, markRemediationDone, respondToCheck, setSessionStatus } from '../../server/services/checks'
import { latestRun, runCollection, startCollection } from '../../server/services/collection'
import { launchCollection, runCollectionById } from '../../server/services/collectionLauncher'
import { notifySchema } from '../../shared/schemas/checks'
import { syncDirectory } from '../../server/services/directory'
import { assignmentEmail, sendAssignmentEmails, type MailMessage } from '../../server/services/notifications'
import { textToDoc } from '../../shared/richText'
import { addConnection, addSite, deleteConnection, getSettings, saveDomains } from '../../server/services/settings'
import type { Database } from '../../server/utils/db'
import { createTestDb, seedSession, TEST_TENANT } from './helpers'

let db: Database
let close: () => Promise<void>

beforeAll(async () => {
  ({ db, close } = await createTestDb())
})
afterAll(() => close())

const line = (n: number) => ({ dedupKey: `k${n}`, label: `Partage ${n}`, data: { resource: `Doc ${n}` } })

describe('mauvaise attribution', () => {
  it('rend la ligne à l\'admin avec le commentaire, annule le retrait à faire, puis repart à zéro à la réassignation', async () => {
    const s = await seedSession(db)
    const item = s.items[0]!
    await assignItems(db, s.admin, s.session.id, { itemIds: [item.id], assigneeId: s.validator.id })
    await respondToCheck(db, s.validator, item.id, { decision: 'remove', comment: 'À couper' })

    const result = await respondToCheck(db, s.validator, item.id, { decision: 'reassign', comment: 'Voir Paul, service achats' })
    expect(result.remediation).toBe('cancelled')
    const [flagged] = await db.select().from(checkItems).where(eq(checkItems.id, item.id))
    expect(flagged).toMatchObject({ decision: 'reassign', assigneeId: null, comment: 'Voir Paul, service achats' })

    // Le valideur ne voit plus la ligne et ne peut plus y répondre.
    await expect(respondToCheck(db, s.validator, item.id, { decision: 'keep', comment: 'x' })).rejects.toMatchObject({ status: 404 })

    const assigned = await assignItems(db, s.admin, s.session.id, { itemIds: [item.id], assigneeId: s.other.id })
    expect(assigned.assigned).toBe(1)
    const [reassigned] = await db.select().from(checkItems).where(eq(checkItems.id, item.id))
    expect(reassigned).toMatchObject({ decision: null, comment: null, assigneeId: s.other.id })

    // Le signalement reste dans l'audit de la réassignation.
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.sessionId, s.session.id), eq(auditLog.action, 'check.assign'))).orderBy(auditLog.id)
      .then(rows => rows.slice(-1))
    expect(JSON.stringify(audit!.before)).toContain('Voir Paul, service achats')

    // Le nouveau valideur demande l'arrêt : le retrait annulé est réactivé.
    expect((await respondToCheck(db, s.other, item.id, { decision: 'remove', comment: 'Confirmé' })).remediation).toBe('reopened')
    const [remediation] = await db.select().from(remediations).where(eq(remediations.checkItemId, item.id))
    expect(remediation!.status).toBe('todo')

    // Accès retiré par l'IT : la ligne ne peut plus repartir en réattribution.
    await markRemediationDone(db, s.admin, remediation!.id, undefined)
    await expect(respondToCheck(db, s.other, item.id, { decision: 'reassign', comment: 'Pas moi' })).rejects.toMatchObject({ status: 409 })
  })
})

describe('collecte', () => {
  const module = (batches: ReturnType<typeof line>[][], fail?: string): ControlModule => ({
    async collect(ctx) {
      for (const batch of batches) await ctx.addLines(batch)
      await ctx.siteError('https://x.sharepoint.com/sites/b', 'Accès refusé')
      if (fail) throw new Error(fail)
    }
  })

  it('exige les domaines internes, une session en brouillon et une seule collecte à la fois', async () => {
    const s = await seedSession(db, 'draft')
    await saveDomains(db, s.admin, [])
    await expect(startCollection(db, s.admin, s.session.id)).rejects.toMatchObject({ status: 400 })

    await saveDomains(db, s.admin, ['fimavi.com'])
    const run = await startCollection(db, s.admin, s.session.id)
    await expect(startCollection(db, s.admin, s.session.id)).rejects.toMatchObject({ status: 409 })
    await runCollection(db, run.id, module([]))

    const open = await seedSession(db, 'open')
    await expect(startCollection(db, open.admin, open.session.id)).rejects.toMatchObject({ status: 409 })
  })

  it('ajoute les lignes en écartant les doublons, y compris à la relance', async () => {
    const s = await seedSession(db, 'draft')
    await saveDomains(db, s.admin, ['fimavi.com'])

    const first = await startCollection(db, s.admin, s.session.id)
    await runCollection(db, first.id, module([[line(1), line(2)], [line(2), line(3)]]))
    const done = await latestRun(db, s.session.id)
    expect(done).toMatchObject({ status: 'succeeded', progress: { added: 3, duplicates: 1, errors: [{ message: 'Accès refusé' }] } })

    const second = await startCollection(db, s.admin, s.session.id)
    await runCollection(db, second.id, module([[line(3), line(4)]]))
    expect((await latestRun(db, s.session.id))!.progress).toMatchObject({ added: 1, duplicates: 1 })

    const rows = await db.select({ rowNumber: checkItems.rowNumber, key: checkItems.dedupKey }).from(checkItems)
      .where(eq(checkItems.sessionId, s.session.id)).orderBy(checkItems.rowNumber)
    // 4 lignes du jeu d'essai + 4 collectées, numérotées à la suite.
    expect(rows.filter(r => r.key).map(r => [r.key, r.rowNumber])).toEqual([['k1', 5], ['k2', 6], ['k3', 7], ['k4', 8]])
  })

  it('consigne un échec et libère la session pour une relance', async () => {
    const s = await seedSession(db, 'draft')
    await saveDomains(db, s.admin, ['fimavi.com'])
    const run = await startCollection(db, s.admin, s.session.id)
    await runCollection(db, run.id, module([[line(1)]], 'Graph indisponible'))
    expect(await latestRun(db, s.session.id)).toMatchObject({ status: 'failed', error: 'Graph indisponible' })
    await expect(startCollection(db, s.admin, s.session.id)).resolves.toBeTruthy()
  })

  it('interdit l\'ouverture pendant la collecte et n\'ajoute plus rien une fois la session sortie du brouillon', async () => {
    const s = await seedSession(db, 'draft')
    await saveDomains(db, s.admin, ['fimavi.com'])
    const run = await startCollection(db, s.admin, s.session.id)
    await expect(setSessionStatus(db, s.admin, s.session.id, 'open')).rejects.toMatchObject({ status: 409 })

    // Session ouverte par un autre chemin pendant la collecte : les lignes suivantes sont refusées.
    await db.update(controlSessions).set({ status: 'open' }).where(eq(controlSessions.id, s.session.id))
    await runCollection(db, run.id, module([[line(1)]]))
    expect(await latestRun(db, s.session.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('brouillon') })
    expect(await db.select().from(checkItems).where(and(eq(checkItems.sessionId, s.session.id), eq(checkItems.dedupKey, 'k1')))).toHaveLength(0)
  })

  it('lance le Job Cloud Run avec le compte de service et l\'identifiant de la collecte', async () => {
    const s = await seedSession(db, 'draft')
    await saveDomains(db, s.admin, ['fimavi.com'])
    const run = await startCollection(db, s.admin, s.session.id)
    const calls: { url: string, init?: RequestInit }[] = []
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return url.startsWith('http://metadata.google.internal/')
        ? Response.json({ access_token: 'sa-token' })
        : Response.json({ name: 'operation' })
    }
    await launchCollection(db, run.id, { job: 'projects/fimavi-controleit/locations/europe-west9/jobs/controleit-collect', fetchImpl })

    expect(calls).toHaveLength(2)
    expect(calls[0]!.url).toBe('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token')
    expect(new Headers(calls[0]!.init?.headers).get('Metadata-Flavor')).toBe('Google')
    expect(calls[1]!.url).toBe('https://run.googleapis.com/v2/projects/fimavi-controleit/locations/europe-west9/jobs/controleit-collect:run')
    expect(new Headers(calls[1]!.init?.headers).get('Authorization')).toBe('Bearer sa-token')
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ overrides: { containerOverrides: [{ env: [{ name: 'NUXT_COLLECTION_RUN_ID', value: run.id }] }] } })
    expect(await latestRun(db, s.session.id)).toMatchObject({ status: 'running' })

    // Le conteneur du Job exécute ensuite la collecte, une seule fois.
    expect(await runCollectionById(db, run.id, () => module([[line(1)]]))).toBe(true)
    expect(await latestRun(db, s.session.id)).toMatchObject({ status: 'succeeded' })
    expect(await runCollectionById(db, run.id, () => module([[line(2)]]))).toBe(false)
  })

  it('consigne l\'échec du lancement du Job et libère la session', async () => {
    const s = await seedSession(db, 'draft')
    await saveDomains(db, s.admin, ['fimavi.com'])
    const job = 'projects/fimavi-controleit/locations/europe-west9/jobs/controleit-collect'
    const denied = async (url: string) => url.startsWith('http://metadata.google.internal/')
      ? Response.json({ access_token: 'sa-token' })
      : new Response('forbidden', { status: 403 })

    const first = await startCollection(db, s.admin, s.session.id)
    await launchCollection(db, first.id, { job, fetchImpl: denied })
    expect(await latestRun(db, s.session.id)).toMatchObject({ status: 'failed', error: 'Lancement de la collecte impossible' })

    // Nom de Job invalide : aucun appel réseau.
    const second = await startCollection(db, s.admin, s.session.id)
    let called = false
    await launchCollection(db, second.id, { job: 'https://evil.example/jobs/x', fetchImpl: async () => { called = true; return new Response() } })
    expect(called).toBe(false)
    expect(await latestRun(db, s.session.id)).toMatchObject({ status: 'failed' })
  })

  it('donne signe de vie pendant une longue étape sans avancement', async () => {
    const s = await seedSession(db, 'draft')
    await saveDomains(db, s.admin, ['fimavi.com'])
    const run = await startCollection(db, s.admin, s.session.id)
    const old = new Date(Date.now() - 9 * 60 * 1000)
    await db.update(collectionRuns).set({ heartbeatAt: old }).where(eq(collectionRuns.id, run.id))
    let seen: Date | undefined
    await runCollection(db, run.id, {
      async collect() {
        await new Promise(resolve => setTimeout(resolve, 200))
        ;[{ heartbeatAt: seen }] = await db.select({ heartbeatAt: collectionRuns.heartbeatAt }).from(collectionRuns).where(eq(collectionRuns.id, run.id))
      }
    }, { heartbeatMs: 20 })
    expect(seen!.getTime()).toBeGreaterThan(old.getTime() + 60 * 1000)
    expect(await latestRun(db, s.session.id)).toMatchObject({ status: 'succeeded' })
  })

  it('arrête au point de contrôle suivant une collecte déclarée interrompue entre-temps', async () => {
    const s = await seedSession(db, 'draft')
    await saveDomains(db, s.admin, ['fimavi.com'])
    const run = await startCollection(db, s.admin, s.session.id)
    let continued = false
    await runCollection(db, run.id, {
      async collect(ctx) {
        await ctx.addLines([line(1)])
        await db.update(collectionRuns).set({ status: 'failed', error: 'Collecte interrompue' }).where(eq(collectionRuns.id, run.id))
        await ctx.progress({ itemsScanned: 10 })
        continued = true
        await ctx.addLines([line(2)])
      }
    })
    expect(continued).toBe(false)
    expect(await latestRun(db, s.session.id)).toMatchObject({ status: 'failed', error: 'Collecte interrompue' })
    const keys = (await db.select({ key: checkItems.dedupKey }).from(checkItems).where(eq(checkItems.sessionId, s.session.id))).map(r => r.key)
    expect(keys).toContain('k1')
    expect(keys).not.toContain('k2')
  })

  it('considère comme interrompue une collecte sans signe de vie', async () => {
    const s = await seedSession(db, 'draft')
    await saveDomains(db, s.admin, ['fimavi.com'])
    const run = await startCollection(db, s.admin, s.session.id)
    await db.update(collectionRuns).set({ heartbeatAt: new Date(Date.now() - 10 * 60 * 1000 - 1000) }).where(eq(collectionRuns.id, run.id))
    expect(await latestRun(db, s.session.id)).toMatchObject({ status: 'failed', error: 'Collecte interrompue' })
  })
})

describe('auteur des partages', () => {
  it('complète les lignes avec l\'auteur et propose son N+1 de l\'annuaire comme valideur', async () => {
    const s = await seedSession(db, 'draft')
    await saveDomains(db, s.admin, ['fimavi.com'])
    const [manager] = await db.insert(users).values({ tenantId: TEST_TENANT, entraId: `mgr-${crypto.randomUUID()}`, displayName: 'Marie Manager', mail: 'marie@fimavi.test' }).returning()
    const objectUrl = 'https://fimavi.sharepoint.com/sites/TSI/Documents/Devis.xlsx'
    const lines = [
      { dedupKey: 'a1', label: 'Devis', data: { objectUrl, beneficiaryEmail: 'invite@client.fr', access: 'Accès direct' } },
      { dedupKey: 'a2', label: 'Autre', data: { objectUrl: 'https://fimavi.sharepoint.com/sites/TSI/Documents/Autre.xlsx', beneficiaryEmail: 'x@client.fr', access: 'Accès direct' } }
    ]
    const graph = {
      get: async () => ({ id: manager!.entraId, displayName: 'Marie Manager' }),
      async* list() { yield [] },
      post: async () => null
    }
    const patches = await authorPatches(db, graph, TEST_TENANT, lines, [
      { objectUrl: normalizeObjectUrl(objectUrl), operation: 'SharingInvitationCreated', author: 'jean@fimavi.com', createdAt: '2026-10-01T00:00:00Z', text: 'invite@client.fr' }
    ])
    expect(patches).toEqual([{ dedupKey: 'a1', data: {
      sharedBy: 'jean@fimavi.com', sharedAt: '2026-10-01T00:00:00Z', sharedByCertain: 'yes',
      suggestedValidatorId: manager!.id, suggestedValidatorName: 'Marie Manager'
    } }])

    // Les données sont fusionnées dans la ligne déjà collectée, sans écraser le reste.
    const run = await startCollection(db, s.admin, s.session.id)
    await runCollection(db, run.id, {
      async collect(ctx) {
        await ctx.addLines(lines)
        await ctx.annotateLines(patches)
      }
    })
    const [row] = await db.select().from(checkItems).where(and(eq(checkItems.sessionId, s.session.id), eq(checkItems.dedupKey, 'a1')))
    expect(row!.data).toMatchObject({ objectUrl, beneficiaryEmail: 'invite@client.fr', sharedBy: 'jean@fimavi.com', suggestedValidatorId: manager!.id })
  })
})

describe('emails aux valideurs', () => {
  it('n\'écrit qu\'aux valideurs ayant des lignes en attente, trace chaque envoi et chaque échec', async () => {
    const s = await seedSession(db, 'open')
    await assignItems(db, s.admin, s.session.id, { itemIds: [s.items[0]!.id, s.items[1]!.id], assigneeId: s.validator.id })
    await assignItems(db, s.admin, s.session.id, { itemIds: [s.items[2]!.id], assigneeId: s.other.id })

    const sent: MailMessage[] = []
    const mailer = async (m: MailMessage) => {
      sent.push(m)
    }
    // s.other n'a pas d'adresse : échec tracé ; s.disabled n'a aucune ligne : ignoré.
    const result = await sendAssignmentEmails(db, s.admin, s.session.id, [s.validator.id, s.other.id, s.disabled.id], { mailer, appUrl: 'https://app.test' })
    expect(result).toEqual({ sent: 1, failed: 1, skipped: 1 })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: 'n1@fimavi.test' })
    expect(sent[0]!.html).toContain('2 vérifications en attente')

    const rows = await db.select().from(notifications).where(eq(notifications.sessionId, s.session.id))
    expect(rows.map(r => r.status).sort()).toEqual(['failed', 'sent'])

    // Relance : nouvel envoi, historisé à côté du premier.
    await sendAssignmentEmails(db, s.admin, s.session.id, [s.validator.id], { mailer, appUrl: 'https://app.test' })
    expect(await db.select().from(notifications).where(and(eq(notifications.sessionId, s.session.id), eq(notifications.recipientId, s.validator.id)))).toHaveLength(2)
  })

  it('envoie aussi aux personnes ajoutées à la main, sans compteur, et ignore les comptes désactivés', async () => {
    const s = await seedSession(db, 'open')
    const sent: MailMessage[] = []
    const result = await sendAssignmentEmails(db, s.admin, s.session.id, [], {
      mailer: async (m) => { sent.push(m) }, appUrl: 'https://app.test', extraRecipientIds: [s.validator.id, s.disabled.id]
    })
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 1 })
    expect(sent[0]).toMatchObject({ to: 'n1@fimavi.test' })
    expect(sent[0]!.html).toContain('Vous êtes sollicité(e) pour la campagne de vérification')
    expect(sent[0]!.html).toContain('href="https://app.test"')
    const [row] = await db.select().from(notifications).where(eq(notifications.sessionId, s.session.id))
    expect(row).toMatchObject({ recipientId: s.validator.id, pendingCount: 0, status: 'sent' })
  })

  it('refuse l\'envoi sur une session en brouillon', async () => {
    const s = await seedSession(db, 'draft')
    await expect(sendAssignmentEmails(db, s.admin, s.session.id, [s.validator.id], { mailer: async () => {}, appUrl: 'https://app.test' }))
      .rejects.toMatchObject({ status: 409 })
  })

  it('échappe le nom de la session et du destinataire dans le HTML', () => {
    const mail = assignmentEmail({ recipientName: '<b>Jean</b>', sessionName: 'Revue <script>alert(1)</script>', pending: 1, appUrl: 'https://app.test' })
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;b&gt;Jean&lt;/b&gt;')
  })

  it('reprend l\'objet et le message de l\'admin, échappés, et ajoute toujours le nombre de lignes et le lien', () => {
    const mail = assignmentEmail({
      recipientName: 'Jean', sessionName: 'Revue T4', pending: 3, appUrl: 'https://app.test',
      subject: 'Merci de répondre', message: textToDoc('Bonjour à tous\n<img src=x onerror=alert(1)>\n\nDeuxième paragraphe')
    })
    expect(mail.subject).toBe('Merci de répondre')
    expect(mail.html).not.toContain('<img')
    expect(mail.html).toContain('<p style="margin:0">Bonjour à tous</p><p style="margin:0">&lt;img src=x onerror=alert(1)&gt;</p><p style="margin:0">&nbsp;</p>')
    expect(mail.html).toContain('<p style="margin:0">Deuxième paragraphe</p>')
    expect(mail.html).toContain('3 vérifications en attente')
    expect(mail.html).toContain('href="https://app.test"')
  })

  it('refuse un objet sur plusieurs lignes ou un message vide', () => {
    const base = { recipientIds: ['3f3f9c3d-d028-45c1-92f4-35e361d352b6'] }
    expect(notifySchema.safeParse({ ...base, subject: 'Objet\nBcc: x@y.z' }).success).toBe(false)
    expect(notifySchema.safeParse({ ...base, message: textToDoc('   ') }).success).toBe(false)
    expect(notifySchema.safeParse({ ...base, message: '<p>HTML refusé</p>' }).success).toBe(false)
    expect(notifySchema.safeParse({ ...base, subject: 'Objet', message: textToDoc('Texte') }).success).toBe(true)
    // Au moins un destinataire, valideur ou personne ajoutée.
    expect(notifySchema.safeParse({ recipientIds: [] }).success).toBe(false)
    expect(notifySchema.safeParse({ recipientIds: [], extraRecipientIds: base.recipientIds }).success).toBe(true)
  })
})

describe('corps de l\'email par défaut', () => {
  it('contient le message puis la signature, dans un seul corps', () => {
    const mail = assignmentEmail({ recipientName: 'Jean', sessionName: 'Revue T4', pending: 1, appUrl: 'https://app.test' })
    expect(mail.html).toContain('Je vous ai confié des partages externes SharePoint à vérifier')
    expect(mail.html).toContain('<strong>Pourquoi ?</strong> Un partage n&#39;expire pas tout seul')
    expect(mail.html).toContain('<p style="margin:0">Cordialement,</p><p style="margin:0"><strong>David DOUILLARD</strong></p>')
    expect(mail.html.indexOf('Merci par avance')).toBeLessThan(mail.html.indexOf('Cordialement'))
  })

  it('remplace [Prénom Nom] et [Vérifications en attente] pour chaque destinataire et joint la bannière', () => {
    const mail = assignmentEmail({ recipientName: 'Jean <Dupont>', sessionName: 'Revue T4', pending: 2, appUrl: 'https://app.test' })
    expect(mail.html).toContain('<p style="margin:0">Bonjour Jean &lt;Dupont&gt;,</p>')
    expect(mail.html).toContain('<strong>Vous avez 2 vérifications en attente dans la campagne « Revue T4 ».</strong><br><a href="https://app.test">Accéder à mes vérifications</a>')
    expect(mail.html).not.toContain('[Prénom Nom]')
    expect(mail.html).not.toContain('[Vérifications en attente]')
    // Le lien n'est pas ajouté une seconde fois quand le champ est présent.
    expect(mail.html.split('Accéder à mes vérifications')).toHaveLength(2)
    expect(mail.html).toContain('<img src="cid:signature-fimavi"')
    expect(mail.inlineImages).toEqual(['signature-fimavi'])
  })

  it('ignore toute image hors de la liste fermée', () => {
    const message = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Texte' }] },
      { type: 'image', attrs: { src: 'https://evil.test/pixel.png' } },
      { type: 'image', attrs: { src: 'data:image/png;base64,AAAA' } }
    ] }
    const mail = assignmentEmail({ recipientName: 'Jean', sessionName: 'Revue', pending: 1, appUrl: 'https://app.test', message })
    expect(mail.html).not.toContain('<img')
    expect(mail.inlineImages).toEqual([])
  })
})

describe('paramètres et annuaire multi-tenant', () => {
  it('raccorde des tenants et des sites, sans doublon, et ne retire un tenant qu\'une fois vidé', async () => {
    const s = await seedSession(db)
    const tenant = await addConnection(db, s.admin, { name: 'Filiale', tenantId: '22222222-2222-2222-2222-222222222222' })
    await expect(addConnection(db, s.admin, { name: 'Doublon', tenantId: '22222222-2222-2222-2222-222222222222' })).rejects.toMatchObject({ status: 409 })
    await addSite(db, s.admin, { connectionId: tenant.id, url: 'https://filiale.sharepoint.com/sites/rh' })
    await expect(addSite(db, s.admin, { connectionId: tenant.id, url: 'https://filiale.sharepoint.com/sites/rh' })).rejects.toMatchObject({ status: 409 })
    await expect(deleteConnection(db, s.admin, tenant.id)).rejects.toMatchObject({ status: 409 })
    expect((await getSettings(db)).sites.some(site => site.url === 'https://filiale.sharepoint.com/sites/rh')).toBe(true)
  })

  it('synchronise chaque tenant, isole les échecs et rattache les comptes historiques au tenant principal', async () => {
    const s = await seedSession(db)
    const [legacy] = await db.insert(users).values({ tenantId: '', entraId: 'legacy-oid', displayName: 'Ancien compte' }).returning()
    await addConnection(db, s.admin, { name: 'Filiale KO', tenantId: '33333333-3333-3333-3333-333333333333' })

    const results = await syncDirectory(db, s.admin, TEST_TENANT, async (tenant) => {
      if (tenant === '33333333-3333-3333-3333-333333333333') throw new Error('Consentement manquant')
      if (tenant === '22222222-2222-2222-2222-222222222222') return [{ id: 'same-oid', displayName: 'Filiale User', mail: 'u@filiale.fr', userPrincipalName: null, jobTitle: null, department: null, accountEnabled: true }]
      return [{ id: 'legacy-oid', displayName: 'Ancien compte (maj)', mail: null, userPrincipalName: null, jobTitle: null, department: null, accountEnabled: true },
        { id: 'same-oid', displayName: 'Homonyme principal', mail: null, userPrincipalName: null, jobTitle: null, department: null, accountEnabled: true }]
    })

    expect(results.find(r => r.name === 'Filiale KO')).toMatchObject({ count: 0, error: 'Consentement manquant' })
    expect(results.find(r => r.tenantId === TEST_TENANT)).toMatchObject({ count: 2 })
    const [claimed] = await db.select().from(users).where(eq(users.id, legacy!.id))
    expect(claimed).toMatchObject({ tenantId: TEST_TENANT, displayName: 'Ancien compte (maj)' })
    // Même object ID dans deux tenants : deux comptes distincts.
    expect(await db.select().from(users).where(eq(users.entraId, 'same-oid'))).toHaveLength(2)
  })
})

describe('session de contrôle', () => {
  it('conserve la configuration du modèle', async () => {
    const s = await seedSession(db, 'draft')
    await db.update(controlSessions).set({ config: { siteIds: ['a'] } }).where(eq(controlSessions.id, s.session.id))
    const [row] = await db.select().from(controlSessions).where(eq(controlSessions.id, s.session.id))
    expect(row!.config).toEqual({ siteIds: ['a'] })
  })
})
