import { defineEventHandler } from 'nuxt/server'
import { latestRun } from '../../../../services/collection'
import { requireAdmin } from '../../../../utils/authz'
import { useDb } from '../../../../utils/db'
import { requireUuidParam } from '../../../../utils/params'

/** Avancement de la dernière collecte (interrogé régulièrement par la page de la session). */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return { run: await latestRun(useDb(), requireUuidParam(event, 'id')) }
})
