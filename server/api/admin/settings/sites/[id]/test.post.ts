import { eq } from 'drizzle-orm'
import { createError, defineEventHandler } from 'nuxt/server'
import { hasFullControl, resolveSite } from '../../../../../controls/sharepoint-external/collect'
import { sharepointSites, tenantConnections } from '../../../../../db/schema'
import { markSiteChecked } from '../../../../../services/settings'
import { requireAdmin } from '../../../../../utils/authz'
import { useDb } from '../../../../../utils/db'
import { graphClient } from '../../../../../utils/graph'
import { siteAccessMessage } from '../../../../../services/graphDiagnostics'
import { requireUuidParam } from '../../../../../utils/params'

/** Vérifie que l'application peut lire le site (consentement, URL) et si elle y a le contrôle total (détection complète). */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = requireUuidParam(event, 'id')
  const db = useDb()
  const [site] = await db.select({ url: sharepointSites.url, tenantId: tenantConnections.tenantId }).from(sharepointSites)
    .innerJoin(tenantConnections, eq(tenantConnections.id, sharepointSites.connectionId))
    .where(eq(sharepointSites.id, id))
  if (!site) throw createError({ status: 404, message: 'Site introuvable' })

  try {
    const resolved = await resolveSite(graphClient(site.tenantId), site.url)
    const displayName = resolved.displayName ?? site.url
    const graph = graphClient(site.tenantId)
    const fullControl = await hasFullControl(graph, resolved.id)
    await markSiteChecked(db, id, displayName)
    return { ok: true, displayName, fullControl }
  } catch (error) {
    const message = siteAccessMessage(error)
    console.error('Test du site en échec :', message)
    return { ok: false, message }
  }
})
