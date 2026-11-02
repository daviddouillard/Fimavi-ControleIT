import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'
import { listRemediations } from '../../../services/checks'
import { requireAdmin } from '../../../utils/authz'
import { useDb } from '../../../utils/db'

const querySchema = z.object({ status: z.enum(['todo', 'done']).default('todo') })

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { status } = await getValidatedQuery(event, querySchema)
  return listRemediations(useDb(), status)
})
