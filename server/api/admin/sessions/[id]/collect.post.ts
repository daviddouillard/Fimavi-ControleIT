import { createError, defineEventHandler, useRuntimeConfig } from 'nuxt/server'
import { eq } from 'drizzle-orm'
import { controlSessions } from '../../../../db/schema'
import { startCollection } from '../../../../services/collection'
import { launchCollection } from '../../../../services/collectionLauncher'
import { requireAdmin } from '../../../../utils/authz'
import { useDb } from '../../../../utils/db'
import { requireUuidParam } from '../../../../utils/params'

/** Relance la collecte d'une session en brouillon : seules les lignes nouvelles sont ajoutées. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const sessionId = requireUuidParam(event, 'id')
  const db = useDb()
  const [session] = await db.select({ template: controlSessions.template }).from(controlSessions).where(eq(controlSessions.id, sessionId))
  if (!session) throw createError({ status: 404, message: 'Session introuvable' })

  const run = await startCollection(db, admin, sessionId, event)
  // Collecte exécutée côté serveur (Cloud Run Job) : la page de la session en suit l'avancement.
  await launchCollection(db, run.id, { job: useRuntimeConfig().collectionJob })
  return run
})
