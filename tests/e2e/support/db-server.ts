// Base PostgreSQL en mémoire (PGlite) exposée en TCP pour les tests E2E, avec les vraies migrations et un jeu de données.
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '../../../server/db/schema'
import { E2E_DB_PORT, E2E_TENANT, IDS, USERS } from './fixtures'

const client = await PGlite.create()
const db = drizzle({ client, schema })
await migrate(db, { migrationsFolder: './server/db/migrations' })

await db.insert(schema.users).values(Object.values(USERS).map(u => ({
  id: u.id, tenantId: E2E_TENANT, entraId: u.entraId, displayName: u.name, mail: u.email
})))
await db.insert(schema.controlSessions).values({
  id: IDS.session, name: 'Revue E2E accès externes', template: 'sharepoint-external', status: 'draft', createdById: IDS.admin
})
await db.insert(schema.checkItems).values(IDS.items.map((id, i) => ({
  id,
  sessionId: IDS.session,
  rowNumber: i + 1,
  dedupKey: `e2e-${i + 1}`,
  label: `Documents / Projet ${i + 1} → invite${i + 1}@externe.test`,
  data: {
    tenant: 'Fimavi',
    site: 'Projets',
    resourceType: 'Dossier',
    resource: `Documents / Projet ${i + 1}`,
    resourceUrl: `https://fimavi.sharepoint.com/sites/projets/Projet${i + 1}`,
    beneficiary: `invite${i + 1}@externe.test`,
    access: 'Accès direct',
    role: 'Lecture'
  }
})))

const server = new PGLiteSocketServer({ db: client, port: E2E_DB_PORT, host: '127.0.0.1', maxConnections: 20 } as ConstructorParameters<typeof PGLiteSocketServer>[0])
await server.start()
console.log(`Base E2E prête sur 127.0.0.1:${E2E_DB_PORT}`)

const stop = async () => {
  await server.stop()
  await client.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
