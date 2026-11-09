import { defineEventHandler } from 'nuxt/server'
import { syncDirectory } from '../../../services/directory'
import { requireAdmin } from '../../../utils/authz'
import { useDb } from '../../../utils/db'
import { listDirectoryMembers } from '../../../utils/graph'
import { homeTenant } from '../../../utils/tenants'

/** Synchronise les collaborateurs Entra ID de tous les tenants raccordés dans la table users. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const tenants = await syncDirectory(useDb(), admin, homeTenant(), listDirectoryMembers, event)
  return { tenants, count: tenants.reduce((sum, t) => sum + t.count, 0), syncedAt: new Date().toISOString() }
})
