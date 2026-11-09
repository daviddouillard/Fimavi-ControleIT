import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { domainsSchema } from '../../../../shared/schemas/settings'
import { saveDomains } from '../../../services/settings'
import { requireAdmin } from '../../../utils/authz'
import { useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { domains } = await readValidatedBody(event, domainsSchema)
  return { domains: await saveDomains(useDb(), admin, domains, event) }
})
