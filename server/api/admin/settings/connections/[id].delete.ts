import { defineEventHandler } from 'nuxt/server'
import { deleteConnection } from '../../../../services/settings'
import { requireAdmin } from '../../../../utils/authz'
import { useDb } from '../../../../utils/db'
import { requireUuidParam } from '../../../../utils/params'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  await deleteConnection(useDb(), admin, requireUuidParam(event, 'id'), event)
  return { ok: true }
})
