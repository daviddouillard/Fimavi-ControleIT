import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { useRuntimeConfig } from 'nuxt/server'
import pg from 'pg'
import * as schema from '../db/schema'

export type Database = NodePgDatabase<typeof schema>
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

let instance: Database | undefined

/** Connexion paresseuse : le serveur démarre même sans base (pages publiques, healthcheck). */
export function useDb(): Database {
  if (!instance) {
    const { databaseUrl } = useRuntimeConfig()
    if (!databaseUrl) throw new Error('NUXT_DATABASE_URL non défini')
    instance = drizzle({ client: new pg.Pool({ connectionString: databaseUrl, max: 10 }), schema })
  }
  return instance
}

export { schema }
