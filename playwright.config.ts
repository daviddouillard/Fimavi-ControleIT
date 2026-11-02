import { randomBytes } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'
import { E2E_DB_PORT } from './tests/e2e/support/fixtures'

const PORT = 3100

// Valeurs factices générées à la volée : aucun secret réel n'est utilisé ni stocké pour les tests.
// Les workers héritent de process.env : le même secret sert au serveur et au scellement des cookies de test.
process.env.E2E_APP_SECRET ??= randomBytes(32).toString('base64')

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx tests/e2e/support/db-server.ts',
      port: E2E_DB_PORT,
      timeout: 60_000,
      reuseExistingServer: false
    },
    {
      command: 'npm run build && node .output/server/index.mjs',
      url: `http://localhost:${PORT}/api/health`,
      timeout: 300_000,
      reuseExistingServer: false,
      env: {
        PORT: String(PORT),
        NUXT_APP_SECRET: process.env.E2E_APP_SECRET,
        NUXT_DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${E2E_DB_PORT}/postgres`,
        NUXT_OAUTH_MICROSOFT_TENANT: '11111111-1111-1111-1111-111111111111',
        NUXT_OAUTH_MICROSOFT_CLIENT_ID: '22222222-2222-2222-2222-222222222222',
        NUXT_OAUTH_MICROSOFT_CLIENT_SECRET: randomBytes(16).toString('hex'),
        NUXT_OAUTH_MICROSOFT_REDIRECT_URL: `http://localhost:${PORT}/auth/microsoft`,
        NUXT_ADMIN_ROLE: 'e2e.admin'
      }
    }
  ]
})
