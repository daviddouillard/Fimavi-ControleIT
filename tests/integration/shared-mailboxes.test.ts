import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sharedMailboxModule } from '../../server/controls/exchange-shared-mailboxes'
import { checkItems, collectionRuns, controlSessions, users } from '../../server/db/schema'
import { runCollection, startCollection } from '../../server/services/collection'
import { assignmentEmail } from '../../server/services/notifications'
import { addConnection, saveDomains } from '../../server/services/settings'
import type { Database } from '../../server/utils/db'
import { ExchangeError, type ExchangeClient } from '../../server/utils/exchange'
import { createSessionSchema } from '../../shared/schemas/session'
import { createTestDb, seedSession, TEST_TENANT } from './helpers'

let db: Database
let close: () => Promise<void>
beforeAll(async () => {
  ({ db, close } = await createTestDb())
})
afterAll(() => close())

const FILIALE = '22222222-2222-2222-2222-222222222222'

/** Exchange simulé : une boîte partagée et ses droits ; le tenant filiale refuse l'accès (rôle non attribué). */
function fakeExchange(tenantId: string, anchor?: string): ExchangeClient {
  return {
    async invoke(cmdlet, parameters) {
      if (tenantId === FILIALE) throw new ExchangeError(403, 'Commande Exchange Get-Mailbox en échec (403)', null)
      expect(anchor).toBe('n1@fimavi.test')
      if (cmdlet === 'Get-Mailbox') {
        expect(parameters).toEqual({ RecipientTypeDetails: 'SharedMailbox', ResultSize: 'Unlimited' })
        return [{ RecipientTypeDetails: 'SharedMailbox', PrimarySmtpAddress: 'compta@fimavi.test', DisplayName: 'Comptabilité', GrantSendOnBehalfTo: ['Jean Dupont'] }]
      }
      if (cmdlet === 'Get-MailboxPermission') {
        return [
          { User: 'NT AUTHORITY\\SELF', AccessRights: ['FullAccess'], IsInherited: false, Deny: false },
          { User: 'n1@fimavi.test', AccessRights: ['FullAccess'], IsInherited: false, Deny: false }
        ]
      }
      return [{ Trustee: 'n1@fimavi.test', AccessControlType: 'Allow', AccessRights: ['SendAs'], IsInherited: false }]
    }
  }
}

describe('modèle « Accès aux boîtes partagées »', () => {
  it('exige au moins un tenant à la création', () => {
    expect(createSessionSchema.safeParse({ name: 'Boîtes T4', template: 'exchange-shared-mailboxes', connectionIds: [] }).success).toBe(false)
    expect(createSessionSchema.safeParse({ name: 'Boîtes T4', template: 'exchange-shared-mailboxes', connectionIds: [crypto.randomUUID()] }).success).toBe(true)
  })

  it('crée une ligne par boîte, titulaire et droit, et isole le tenant en échec', async () => {
    const s = await seedSession(db, 'draft')
    await db.update(users).set({ userPrincipalName: 'n1@fimavi.test' }).where(eq(users.id, s.validator.id))
    await saveDomains(db, s.admin, ['fimavi.test'])
    const home = await addConnection(db, s.admin, { name: 'Fimavi', tenantId: TEST_TENANT })
    const filiale = await addConnection(db, s.admin, { name: 'Filiale', tenantId: FILIALE })
    await db.update(controlSessions).set({ template: 'exchange-shared-mailboxes', config: { connectionIds: [home.id, filiale.id] } }).where(eq(controlSessions.id, s.session.id))
    await db.delete(checkItems).where(eq(checkItems.sessionId, s.session.id))

    const run = await startCollection(db, s.admin, s.session.id)
    await runCollection(db, run.id, sharedMailboxModule({ exchangeFor: fakeExchange }))

    const lines = await db.select().from(checkItems).where(eq(checkItems.sessionId, s.session.id)).orderBy(checkItems.rowNumber)
    expect(lines.map(l => [l.data.mailbox, l.data.trustee, l.data.right])).toEqual([
      ['compta@fimavi.test', 'n1@fimavi.test', 'Accès total'],
      ['compta@fimavi.test', 'n1@fimavi.test', 'Envoyer en tant que'],
      ['compta@fimavi.test', 'Jean Dupont', 'Envoyer de la part de']
    ])
    // Titulaire retrouvé dans l'annuaire synchronisé.
    expect(lines[0]!.data.trusteeName).toBe('Valideur N+1')

    const [done] = await db.select().from(collectionRuns).where(eq(collectionRuns.id, run.id))
    expect(done!.status).toBe('succeeded')
    expect(done!.progress).toMatchObject({ added: 3, errors: [{ source: 'Filiale', message: 'Commande Exchange Get-Mailbox en échec (403)' }] })
  })

  it('propose un objet et un message propres aux boîtes partagées', () => {
    const mail = assignmentEmail({ recipientName: 'Jean', sessionName: 'Boîtes T4', pending: 1, appUrl: 'https://app.test', template: 'exchange-shared-mailboxes' })
    expect(mail.subject).toBe('Contrôles IT : accès aux boîtes partagées à vérifier — Boîtes T4')
    expect(mail.html).toContain('accès à des boîtes aux lettres partagées')
  })
})
