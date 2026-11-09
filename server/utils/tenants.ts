import { eq } from 'drizzle-orm'
import { useRuntimeConfig } from 'nuxt/server'
import { tenantConnections, users } from '../db/schema'
import type { Database } from './db'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isTenantGuid(value: string): boolean {
  return GUID.test(value)
}

/** Tenant principal (Fimavi) : seul tenant dont les comptes peuvent être administrateurs. */
export function homeTenant(): string {
  const { tenant } = useRuntimeConfig().oauth.microsoft
  if (!tenant) throw new Error('Configuration Entra incomplète')
  return tenant.toLowerCase()
}

/** Tenants dont les collaborateurs peuvent se connecter : le tenant principal et les tenants raccordés actifs. */
export async function allowedTenants(db: Pick<Database, 'select'>, home: string): Promise<Set<string>> {
  const rows = await db.select({ tenantId: tenantConnections.tenantId }).from(tenantConnections)
    .where(eq(tenantConnections.enabled, true))
  return new Set([home, ...rows.map(r => r.tenantId.toLowerCase())])
}

/** Comptes créés avant le multi-tenant (tenant vide) : ils appartiennent au tenant principal. */
export async function claimLegacyUsers(db: Pick<Database, 'update'>, home: string) {
  await db.update(users).set({ tenantId: home }).where(eq(users.tenantId, ''))
}
