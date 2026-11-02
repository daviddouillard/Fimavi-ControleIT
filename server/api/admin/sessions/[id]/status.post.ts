import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { sessionStatusSchema } from '../../../../../shared/schemas/checks'
import { setSessionStatus } from '../../../../services/checks'
import { requireAdmin } from '../../../../utils/authz'
import { useDb } from '../../../../utils/db'
import { requireUuidParam } from '../../../../utils/params'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const sessionId = requireUuidParam(event, 'id')
  const { status } = await readValidatedBody(event, sessionStatusSchema)
  return setSessionStatus(useDb(), admin, sessionId, status, event)
})
