import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { responseSchema } from '../../../../../shared/schemas/checks'
import { respondToCheck } from '../../../../services/checks'
import { requireUser } from '../../../../utils/authz'
import { useDb } from '../../../../utils/db'
import { requireUuidParam } from '../../../../utils/params'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const itemId = requireUuidParam(event, 'id')
  const input = await readValidatedBody(event, responseSchema)
  return respondToCheck(useDb(), user, itemId, input, event)
})
