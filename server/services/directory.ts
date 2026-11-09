import { eq, sql } from 'drizzle-orm'
import type { RequestEvent } from 'nuxt/server'
import { tenantConnections, users } from '../db/schema'
import { recordAudit } from '../utils/audit'
import type { Database } from '../utils/db'
import type { GraphUser } from '../utils/graph'
import { claimLegacyUsers } from '../utils/tenants'
import type { Actor } from './checks'

export interface TenantSyncResult {
  tenantId: string
  name: string
  count: number
  error?: string
}

/**
 * Synchronise les collaborateurs du tenant principal et de chaque tenant raccordé actif.
 * Un tenant en échec (consentement manquant…) n'empêche pas la synchronisation des autres.
 */
export async function syncDirectory(
  db: Database,
  actor: Actor,
  home: string,
  fetchMembers: (tenant: string) => Promise<GraphUser[]>,
  event?: RequestEvent
): Promise<TenantSyncResult[]> {
  const connections = await db.select({ tenantId: tenantConnections.tenantId, name: tenantConnections.name })
    .from(tenantConnections).where(eq(tenantConnections.enabled, true))
  const targets = [{ tenantId: home, name: 'Tenant principal' }, ...connections.filter(c => c.tenantId.toLowerCase() !== home)]

  const results: TenantSyncResult[] = []
  for (const target of targets) {
    const tenantId = target.tenantId.toLowerCase()
    let members: GraphUser[]
    try {
      members = await fetchMembers(tenantId)
    } catch (error) {
      results.push({ tenantId, name: target.name, count: 0, error: error instanceof Error ? error.message : 'erreur inconnue' })
      continue
    }

    const now = new Date()
    await db.transaction(async (tx) => {
      if (tenantId === home) await claimLegacyUsers(tx, home)
      for (let i = 0; i < members.length; i += 500) {
        const batch = members.slice(i, i + 500).map(m => ({
          tenantId,
          entraId: m.id,
          displayName: m.displayName ?? m.userPrincipalName ?? m.id,
          mail: m.mail,
          userPrincipalName: m.userPrincipalName,
          jobTitle: m.jobTitle,
          department: m.department,
          accountEnabled: m.accountEnabled ?? true,
          lastSyncedAt: now
        }))
        await tx.insert(users).values(batch).onConflictDoUpdate({
          target: [users.tenantId, users.entraId],
          set: {
            displayName: sql`excluded.display_name`,
            mail: sql`excluded.mail`,
            userPrincipalName: sql`excluded.user_principal_name`,
            jobTitle: sql`excluded.job_title`,
            department: sql`excluded.department`,
            accountEnabled: sql`excluded.account_enabled`,
            lastSyncedAt: sql`excluded.last_synced_at`
          }
        })
      }
    })
    results.push({ tenantId, name: target.name, count: members.length })
  }

  await recordAudit(db, { actorId: actor.id, action: 'directory.sync', entityType: 'directory', after: { tenants: results } }, event)
  return results
}
