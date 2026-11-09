import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '../../server/db/schema'
import { listSessionSummaries } from '../../server/utils/sessionQueries'

// PostgreSQL en mémoire (WebAssembly) : on applique les vraies migrations du projet.
const client = new PGlite()
const db = drizzle({ client, schema })

beforeAll(async () => {
  await migrate(db, { migrationsFolder: './server/db/migrations' })
})

afterAll(async () => {
  await client.close()
})

describe('migrations et journal d\'audit', () => {
  it('le journal accepte les insertions mais refuse UPDATE, DELETE et TRUNCATE', async () => {
    await db.insert(schema.auditLog).values({ action: 'test.insert', entityType: 'test' })

    await expect(db.update(schema.auditLog).set({ action: 'falsifié' })).rejects.toThrow()
    await expect(db.delete(schema.auditLog)).rejects.toThrow()
    await expect(db.execute(sql`truncate audit_log`)).rejects.toThrow()

    const rows = await db.select().from(schema.auditLog)
    expect(rows.map(r => r.action)).toContain('test.insert')
  })
})

describe('listSessionSummaries', () => {
  it('calcule l\'avancement de chaque session', async () => {
    const [admin, n1] = await db.insert(schema.users).values([
      { tenantId: 't1', entraId: 'oid-admin', displayName: 'Admin IT' },
      { tenantId: 't1', entraId: 'oid-n1', displayName: 'Manager N+1' }
    ]).returning()

    const [session] = await db.insert(schema.controlSessions).values({
      name: 'Revue T4', template: 'sharepoint-external', status: 'open', createdById: admin!.id
    }).returning()

    const items = await db.insert(schema.checkItems).values([
      { sessionId: session!.id, rowNumber: 1, data: {}, label: 'A', assigneeId: n1!.id, decision: 'keep' },
      { sessionId: session!.id, rowNumber: 2, data: {}, label: 'B', assigneeId: n1!.id, decision: 'remove' },
      { sessionId: session!.id, rowNumber: 3, data: {}, label: 'C', assigneeId: n1!.id },
      { sessionId: session!.id, rowNumber: 4, data: {}, label: 'D' },
      { sessionId: session!.id, rowNumber: 5, data: {}, label: 'E', closedAt: new Date() },
      { sessionId: session!.id, rowNumber: 6, data: {}, label: 'F', decision: 'reassign', comment: 'Voir le service achats' }
    ]).returning()
    await db.insert(schema.remediations).values({ checkItemId: items[1]!.id })

    const [summary] = await listSessionSummaries(db as never)
    expect(summary).toMatchObject({ totalItems: 6, answered: 2, waiting: 1, unassigned: 1, toReassign: 1, closedWithoutValidation: 1, remediationsTodo: 1 })
  })
})
