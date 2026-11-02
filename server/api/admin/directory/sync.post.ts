import { sql } from 'drizzle-orm'
import { defineEventHandler } from 'nuxt/server'
import { users } from '../../../db/schema'
import { recordAudit } from '../../../utils/audit'
import { requireAdmin } from '../../../utils/authz'
import { useDb } from '../../../utils/db'
import { listDirectoryMembers } from '../../../utils/graph'

/** Synchronise les collaborateurs Entra ID dans la table users. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const members = await listDirectoryMembers()
  const now = new Date()

  const db = useDb()
  await db.transaction(async (tx) => {
    for (let i = 0; i < members.length; i += 500) {
      const batch = members.slice(i, i + 500).map(m => ({
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
        target: users.entraId,
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
    await recordAudit(tx, { actorId: admin.id, action: 'directory.sync', entityType: 'directory', after: { count: members.length } }, event)
  })

  return { count: members.length, syncedAt: now.toISOString() }
})
