import { defineConfig } from 'drizzle-kit'

// Les migrations utilisent un rôle propriétaire distinct du rôle applicatif (voir docs/base-de-donnees.md).
export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? ''
  }
})
