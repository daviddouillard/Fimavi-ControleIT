import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '../../server/db/schema'
import type { Database } from '../../server/utils/db'

/** PostgreSQL en mémoire avec les vraies migrations du projet. */
export async function createTestDb() {
  const client = new PGlite()
  const pglite = drizzle({ client, schema })
  await migrate(pglite, { migrationsFolder: './server/db/migrations' })
  // Même API que node-postgres pour ce que l'application utilise.
  return { db: pglite as unknown as Database, close: () => client.close() }
}

export async function seedSession(db: Database, status: 'draft' | 'open' | 'closed' = 'open') {
  const [admin, validator, other, disabled] = await db.insert(schema.users).values([
    { entraId: `admin-${crypto.randomUUID()}`, displayName: 'Admin IT' },
    { entraId: `val-${crypto.randomUUID()}`, displayName: 'Valideur N+1', mail: 'n1@fimavi.test' },
    { entraId: `other-${crypto.randomUUID()}`, displayName: 'Autre manager' },
    { entraId: `off-${crypto.randomUUID()}`, displayName: 'Compte désactivé', accountEnabled: false }
  ]).returning()

  const [session] = await db.insert(schema.controlSessions).values({
    name: 'Revue', template: 'sharepoint-external', status, createdById: admin!.id
  }).returning()

  const items = await db.insert(schema.checkItems).values(
    [1, 2, 3, 4].map(n => ({ sessionId: session!.id, rowNumber: n, data: {}, label: `Accès ${n}` }))
  ).returning()

  return { admin: admin!, validator: validator!, other: other!, disabled: disabled!, session: session!, items }
}
