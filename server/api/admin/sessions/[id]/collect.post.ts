import { createError, defineEventHandler } from 'nuxt/server'
import { eq } from 'drizzle-orm'
import { controlModule } from '../../../../controls'
import { controlSessions } from '../../../../db/schema'
import { runCollection, startCollection } from '../../../../services/collection'
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
  runCollection(db, run.id, controlModule(session.template)).catch(error => console.error('Collecte non démarrée :', error instanceof Error ? error.message : 'erreur inconnue'))
  return run
})
