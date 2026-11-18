import { and, eq, inArray } from 'drizzle-orm'
import { createError, defineEventHandler, readValidatedBody, useRuntimeConfig } from 'nuxt/server'
import { createSessionSchema } from '../../../../shared/schemas/session'
import { controlSessions, sharepointSites, tenantConnections } from '../../../db/schema'
import { startCollection } from '../../../services/collection'
import { launchCollection } from '../../../services/collectionLauncher'
import { recordAudit } from '../../../utils/audit'
import { requireAdmin } from '../../../utils/authz'
import { useDb } from '../../../utils/db'

/** Crée une session en brouillon puis lance aussitôt la collecte des lignes du modèle choisi. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const input = await readValidatedBody(event, createSessionSchema)
  const db = useDb()

  const session = await db.transaction(async (tx) => {
    // Seules les données du modèle choisi sont retenues.
    const siteIds = input.template === 'sharepoint-external' ? input.siteIds ?? [] : []
    const connectionIds = input.template === 'exchange-shared-mailboxes' ? input.connectionIds ?? [] : []
    if (siteIds.length) {
      const found = await tx.select({ id: sharepointSites.id }).from(sharepointSites)
        .where(and(inArray(sharepointSites.id, siteIds), eq(sharepointSites.enabled, true)))
      if (found.length !== siteIds.length) throw createError({ status: 400, message: 'Site inconnu ou désactivé' })
    }
    if (connectionIds.length) {
      const found = await tx.select({ id: tenantConnections.id }).from(tenantConnections)
        .where(and(inArray(tenantConnections.id, connectionIds), eq(tenantConnections.enabled, true)))
      if (found.length !== connectionIds.length) throw createError({ status: 400, message: 'Tenant inconnu ou désactivé' })
    }
    const [row] = await tx.insert(controlSessions).values({
      name: input.name,
      description: input.description,
      template: input.template,
      // Noms de domaine Gandi : aucune option, toute l'organisation du jeton est lue.
      config: input.template === 'exchange-shared-mailboxes' ? { connectionIds } : input.template === 'gandi-domains' ? {} : { siteIds },
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      createdById: admin.id
    }).returning()
    await recordAudit(tx, { actorId: admin.id, action: 'session.create', entityType: 'control_session', entityId: row!.id, sessionId: row!.id, after: row }, event)
    return row!
  })

  const run = await startCollection(db, admin, session.id, event)
  // Collecte exécutée côté serveur (Cloud Run Job) : la page de la session en suit l'avancement.
  await launchCollection(db, run.id, { job: useRuntimeConfig().collectionJob })
  return session
})
