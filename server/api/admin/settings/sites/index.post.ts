import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { siteCreateSchema } from '../../../../../shared/schemas/settings'
import { addSite } from '../../../../services/settings'
import { requireAdmin } from '../../../../utils/authz'
import { useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const input = await readValidatedBody(event, siteCreateSchema)
  return addSite(useDb(), admin, input, event)
})
