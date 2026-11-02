import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { closeItemsSchema } from '../../../../../shared/schemas/checks'
import { closeItemsWithoutValidation } from '../../../../services/checks'
import { requireAdmin } from '../../../../utils/authz'
import { useDb } from '../../../../utils/db'
import { requireUuidParam } from '../../../../utils/params'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const sessionId = requireUuidParam(event, 'id')
  const { itemIds } = await readValidatedBody(event, closeItemsSchema)
  return closeItemsWithoutValidation(useDb(), admin, sessionId, itemIds, event)
})
