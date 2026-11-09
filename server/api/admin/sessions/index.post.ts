import { and, eq, inArray } from 'drizzle-orm'
import { createError, defineEventHandler, readValidatedBody } from 'nuxt/server'
import { createSessionSchema } from '../../../../shared/schemas/session'
import { controlModule } from '../../../controls'
import { controlSessions, sharepointSites } from '../../../db/schema'
import { runCollection, startCollection } from '../../../services/collection'
import { recordAudit } from '../../../utils/audit'
import { requireAdmin } from '../../../utils/authz'
import { useDb } from '../../../utils/db'

/** Crée une session en brouillon puis lance aussitôt la collecte des lignes du modèle choisi. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const input = await readValidatedBody(event, createSessionSchema)
  const db = useDb()

  const session = await db.transaction(async (tx) => {
    const siteIds = input.siteIds ?? []
    if (siteIds.length) {
      const found = await tx.select({ id: sharepointSites.id }).from(sharepointSites)
        .where(and(inArray(sharepointSites.id, siteIds), eq(sharepointSites.enabled, true)))
      if (found.length !== siteIds.length) throw createError({ status: 400, message: 'Site inconnu ou désactivé' })
    }
    const [row] = await tx.insert(controlSessions).values({
      name: input.name,
      description: input.description,
      template: input.template,
      config: { siteIds },
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      createdById: admin.id
    }).returning()
    await recordAudit(tx, { actorId: admin.id, action: 'session.create', entityType: 'control_session', entityId: row!.id, sessionId: row!.id, after: row }, event)
    return row!
  })

  const run = await startCollection(db, admin, session.id, event)
  // Collecte en arrière-plan : la page de la session en suit l'avancement.
  runCollection(db, run.id, controlModule(session.template)).catch(error => console.error('Collecte non démarrée :', error instanceof Error ? error.message : 'erreur inconnue'))
  return session
})
