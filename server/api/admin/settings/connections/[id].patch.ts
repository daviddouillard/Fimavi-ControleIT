import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { connectionUpdateSchema } from '../../../../../shared/schemas/settings'
import { updateConnection } from '../../../../services/settings'
import { requireAdmin } from '../../../../utils/authz'
import { useDb } from '../../../../utils/db'
import { requireUuidParam } from '../../../../utils/params'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = requireUuidParam(event, 'id')
  const input = await readValidatedBody(event, connectionUpdateSchema)
  return updateConnection(useDb(), admin, id, input, event)
})
