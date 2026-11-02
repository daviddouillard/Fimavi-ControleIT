import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { remediationDoneSchema } from '../../../../../shared/schemas/checks'
import { markRemediationDone } from '../../../../services/checks'
import { requireAdmin } from '../../../../utils/authz'
import { useDb } from '../../../../utils/db'
import { requireUuidParam } from '../../../../utils/params'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const remediationId = requireUuidParam(event, 'id')
  const { note } = await readValidatedBody(event, remediationDoneSchema)
  return markRemediationDone(useDb(), admin, remediationId, note, event)
})
