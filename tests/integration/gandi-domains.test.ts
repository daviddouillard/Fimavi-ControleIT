import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gandiDomainsModule } from '../../server/controls/gandi-domains'
import { checkItems, collectionRuns, controlSessions } from '../../server/db/schema'
import { runCollection, startCollection } from '../../server/services/collection'
import { saveDomains } from '../../server/services/settings'
import type { Database } from '../../server/utils/db'
import { GandiError } from '../../server/utils/gandi'
import { createSessionSchema } from '../../shared/schemas/session'
import { createTestDb, seedSession } from './helpers'

let db: Database
let close: () => Promise<void>
beforeAll(async () => {
  ({ db, close } = await createTestDb())
})
afterAll(() => close())

async function gandiSession() {
  const s = await seedSession(db, 'draft')
  await saveDomains(db, s.admin, ['fimavi.test'])
  await db.update(controlSessions).set({ template: 'gandi-domains', config: {} }).where(eq(controlSessions.id, s.session.id))
  await db.delete(checkItems).where(eq(checkItems.sessionId, s.session.id))
  return s
}

describe('modèle « Services Gandi »', () => {
  it('se crée sans site ni tenant', () => {
    expect(createSessionSchema.safeParse({ name: 'Domaines 2027', template: 'gandi-domains' }).success).toBe(true)
  })

  it('crée une ligne par domaine, certificat actif et hébergement, échéances les plus proches d\'abord', async () => {
    const s = await gandiSession()
    const run = await startCollection(db, s.admin, s.session.id)
    await runCollection(db, run.id, gandiDomainsModule({
      gandi: () => ({
        listDomains: async () => [
          { fqdn: 'lointain.fr', tld: 'fr', autorenew: true, dates: { registry_ends_at: '2029-01-01T00:00:00Z' } },
          { fqdn: 'proche.com', tld: 'com', autorenew: false, dates: { registry_ends_at: '2027-01-01T00:00:00Z' } }
        ],
        listCertificates: async () => [
          { id: 'c1', cn: 'www.proche.com', status: 'valid', dates: { ends_at: '2027-06-01T00:00:00Z' } },
          { id: 'c0', cn: 'ancien.com', status: 'expired', dates: { ends_at: '2020-01-01T00:00:00Z' } }
        ],
        listHostings: async () => [{ id: 'h1', name: 'vitrine', expire_at: '2026-12-15T00:00:00Z' }]
      })
    }))
    const lines = await db.select().from(checkItems).where(eq(checkItems.sessionId, s.session.id)).orderBy(checkItems.rowNumber)
    expect(lines.map(l => [l.data.domain, l.data.gandiKind ?? 'domaine'])).toEqual([['vitrine', 'Hébergement web'], ['proche.com', 'domaine'], ['www.proche.com', 'Certificat SSL'], ['lointain.fr', 'domaine']])
    const [done] = await db.select().from(collectionRuns).where(eq(collectionRuns.id, run.id))
    expect(done!.status).toBe('succeeded')
  })

  it('un type refusé par le jeton est signalé sans bloquer les autres', async () => {
    const s = await gandiSession()
    const run = await startCollection(db, s.admin, s.session.id)
    await runCollection(db, run.id, gandiDomainsModule({
      gandi: () => ({
        listDomains: async () => [{ fqdn: 'fimavi.com', dates: { registry_ends_at: '2027-01-01T00:00:00Z' } }],
        listCertificates: async () => { throw new GandiError(403, 'Lecture Gandi en échec (403)', null) },
        listHostings: async () => []
      })
    }))
    const [done] = await db.select().from(collectionRuns).where(eq(collectionRuns.id, run.id))
    expect(JSON.stringify(done!.progress)).toContain('voir les certificats SSL')
    const lines = await db.select().from(checkItems).where(eq(checkItems.sessionId, s.session.id))
    expect(lines.map(l => l.data.domain)).toEqual(['fimavi.com'])
  })
})
