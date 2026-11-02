import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { userSearchSchema } from '../../../shared/schemas/checks'
import { searchUsers } from '../../services/checks'
import { requireAdmin } from '../../utils/authz'
import { useDb } from '../../utils/db'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { q } = await getValidatedQuery(event, userSearchSchema)
  return searchUsers(useDb(), q)
})
