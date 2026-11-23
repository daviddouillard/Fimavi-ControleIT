import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NO_GROUP_ANOMALY, sageAccessModule } from '../../server/controls/sage-access'
import { checkItems, collectionRuns, controlSessions } from '../../server/db/schema'
import { runCollection, startCollection } from '../../server/services/collection'
import { saveDomains } from '../../server/services/settings'
import type { Database } from '../../server/utils/db'
import { GraphError, type GraphClient } from '../../server/utils/graph'
import { SageApiError, type SageLogin } from '../../server/utils/sageApi'
import { createSessionSchema } from '../../shared/schemas/session'
import { createTestDb, seedSession, TEST_TENANT } from './helpers'

let db: Database
let close: () => Promise<void>
beforeAll(async () => {
  ({ db, close } = await createTestDb())
})
afterAll(() => close())

async function sageSession() {
  const s = await seedSession(db, 'draft')
  await saveDomains(db, s.admin, ['fimavi.test'])
  await db.update(controlSessions).set({ template: 'sage-access', config: {} }).where(eq(controlSessions.id, s.session.id))
  await db.delete(checkItems).where(eq(checkItems.sessionId, s.session.id))
  return s
}

const LOGINS: SageLogin[] = [
  { ID_LOGIN_SAGE: 1, PR_Nom: 'JDUPONT', id_ad: 'jean.dupont', site: 1016, IntituleDossier: 'DOMOS' },
  { ID_LOGIN_SAGE: 2, PR_Nom: 'JDUPONT', id_ad: 'jean.dupont', site: 1017, IntituleDossier: 'BEES' },
  { ID_LOGIN_SAGE: 3, PR_Nom: 'PARTI', id_ad: 'ancien.salarie', site: 1016, IntituleDossier: 'DOMOS' },
  // Doublon exact : une seule ligne.
  { ID_LOGIN_SAGE: 4, PR_Nom: 'JDUPONT', id_ad: 'jean.dupont', site: 1016, IntituleDossier: 'DOMOS' }
]

/** Graph simulé : annuaire, groupes par nom, membres et N+1. */
function fakeGraph(managerEntraId: string, opts: { groupsDenied?: boolean } = {}): GraphClient {
  const directory = [
    { id: 'u-jean', displayName: 'Jean Dupont', userPrincipalName: 'jean.dupont@fimavi.test', onPremisesSamAccountName: 'jean.dupont', accountEnabled: true }
  ]
  return {
    async get(path: string) {
      if (path.startsWith('groups?')) {
        if (opts.groupsDenied) throw new GraphError(403, 'Appel Graph en échec (403)', 'Authorization_RequestDenied')
        const name = decodeURIComponent(path).match(/displayName eq '([^']+)'/)![1]!
        return { value: [{ id: `g-${name}` }] }
      }
      if (path.startsWith('users/u-jean/manager')) return { id: managerEntraId, displayName: 'Valideur N+1' }
      throw new GraphError(404, 'introuvable')
    },
    async* list(path: string) {
      if (path.startsWith('users?')) yield directory
      else if (path.startsWith('groups/g-COMPTA_USER/')) yield [{ id: 'u-jean' }]
      else yield []
    },
    async post() { return null }
  }
}

describe('modèle « Accès Sage »', () => {
  it('se crée sans site ni tenant', () => {
    expect(createSessionSchema.safeParse({ name: 'Sage T4', template: 'sage-access' }).success).toBe(true)
  })

  it('une ligne par personne et par dossier, écarts d\'abord, N+1 suggéré', async () => {
    const s = await sageSession()
    const run = await startCollection(db, s.admin, s.session.id)
    await runCollection(db, run.id, sageAccessModule({
      sage: () => ({ listLogins: async () => LOGINS }),
      graph: () => fakeGraph(s.validator.entraId),
      homeTenant: TEST_TENANT,
      groups: ['COMPTA_USER', 'MDP_USER', 'GESTCOM_USER']
    }))
    const lines = await db.select().from(checkItems).where(eq(checkItems.sessionId, s.session.id)).orderBy(checkItems.rowNumber)
    expect(lines.map(l => [l.data.personName, l.data.sageDossier, l.data.entraGroups, l.data.anomaly ?? null])).toEqual([
      ['ancien.salarie', 'DOMOS', 'Aucun', NO_GROUP_ANOMALY],
      ['Jean Dupont', 'BEES', 'COMPTA_USER', null],
      ['Jean Dupont', 'DOMOS', 'COMPTA_USER', null]
    ])
    expect(lines[1]!.data.suggestedValidatorId).toBe(s.validator.id)
    expect(lines[0]!.data.suggestedValidatorId).toBeUndefined()
    const [done] = await db.select().from(collectionRuns).where(eq(collectionRuns.id, run.id))
    expect(done!.status).toBe('succeeded')
    expect(done!.progress).toMatchObject({ duplicates: 1 })
  })

  it('groupes illisibles (permission manquante) : signalé, et aucun écart inventé', async () => {
    const s = await sageSession()
    const run = await startCollection(db, s.admin, s.session.id)
    await runCollection(db, run.id, sageAccessModule({
      sage: () => ({ listLogins: async () => LOGINS }),
      graph: () => fakeGraph(s.validator.entraId, { groupsDenied: true }),
      homeTenant: TEST_TENANT,
      groups: ['COMPTA_USER']
    }))
    const [done] = await db.select().from(collectionRuns).where(eq(collectionRuns.id, run.id))
    expect(JSON.stringify(done!.progress)).toContain('GroupMember.Read.All')
    const lines = await db.select().from(checkItems).where(eq(checkItems.sessionId, s.session.id))
    expect(lines).toHaveLength(3)
    expect(lines.every(l => !l.data.anomaly && !l.data.entraGroups)).toBe(true)
  })

  it('API Sage injoignable : signalé, aucune ligne', async () => {
    const s = await sageSession()
    const run = await startCollection(db, s.admin, s.session.id)
    await runCollection(db, run.id, sageAccessModule({
      sage: () => ({ listLogins: async () => { throw new SageApiError(0, 'API Sage injoignable (réseau, délai dépassé ou adresse IP non autorisée)', null) } }),
      graph: () => fakeGraph(s.validator.entraId),
      homeTenant: TEST_TENANT,
      groups: ['COMPTA_USER']
    }))
    const [done] = await db.select().from(collectionRuns).where(eq(collectionRuns.id, run.id))
    expect(JSON.stringify(done!.progress)).toContain('injoignable')
    expect(await db.select().from(checkItems).where(eq(checkItems.sessionId, s.session.id))).toHaveLength(0)
  })
})
