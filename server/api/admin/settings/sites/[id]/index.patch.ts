import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { siteUpdateSchema } from '../../../../../../shared/schemas/settings'
import { updateSite } from '../../../../../services/settings'
import { requireAdmin } from '../../../../../utils/authz'
import { useDb } from '../../../../../utils/db'
import { requireUuidParam } from '../../../../../utils/params'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = requireUuidParam(event, 'id')
  const input = await readValidatedBody(event, siteUpdateSchema)
  return updateSite(useDb(), admin, id, input, event)
})
