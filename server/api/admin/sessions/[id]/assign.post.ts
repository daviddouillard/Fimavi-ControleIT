import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { assignSchema } from '../../../../../shared/schemas/checks'
import { assignItems } from '../../../../services/checks'
import { requireAdmin } from '../../../../utils/authz'
import { useDb } from '../../../../utils/db'
import { requireUuidParam } from '../../../../utils/params'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const sessionId = requireUuidParam(event, 'id')
  const input = await readValidatedBody(event, assignSchema)
  return assignItems(useDb(), admin, sessionId, input, event)
})
