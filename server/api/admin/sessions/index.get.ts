import { defineEventHandler } from 'nuxt/server'
import { requireAdmin } from '../../../utils/authz'
import { useDb } from '../../../utils/db'
import { listSessionSummaries } from '../../../utils/sessionQueries'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return listSessionSummaries(useDb())
})
