import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { connectionCreateSchema } from '../../../../../shared/schemas/settings'
import { addConnection } from '../../../../services/settings'
import { requireAdmin } from '../../../../utils/authz'
import { useDb } from '../../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const input = await readValidatedBody(event, connectionCreateSchema)
  return addConnection(useDb(), admin, input, event)
})
