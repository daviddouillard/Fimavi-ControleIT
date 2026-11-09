import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { sharepointSites, tenantConnections } from '../../db/schema'
import type { Database } from '../../utils/db'
import type { GraphClient } from '../../utils/graph'
import type { CollectionContext, ControlModule } from '../types'
import { collectSiteShares } from './collect'

export const sharepointConfigSchema = z.object({ siteIds: z.array(z.uuid()).min(1).max(500) })

export interface SharepointDeps {
  graphFor: (tenantId: string) => GraphClient
}

/** Sites retenus pour la session, encore déclarés et actifs, avec leur tenant (actif lui aussi). */
export async function sessionSites(db: Pick<Database, 'select'>, siteIds: string[]) {
  return db.select({
    id: sharepointSites.id,
    url: sharepointSites.url,
    tenantId: tenantConnections.tenantId,
    tenantName: tenantConnections.name
  })
    .from(sharepointSites)
    .innerJoin(tenantConnections, eq(tenantConnections.id, sharepointSites.connectionId))
    .where(and(inArray(sharepointSites.id, siteIds), eq(sharepointSites.enabled, true), eq(tenantConnections.enabled, true)))
}

export function sharepointModule(deps: SharepointDeps): ControlModule {
  return {
    async collect(ctx: CollectionContext) {
      const { siteIds } = sharepointConfigSchema.parse(ctx.config)
      const sites = await sessionSites(ctx.db, siteIds)
      if (!sites.length) throw new Error('Aucun site actif à analyser')
      if (!ctx.internalDomains.size) throw new Error('Aucun domaine interne paramétré')

      for (const [index, site] of sites.entries()) {
        try {
          const lines = await collectSiteShares(deps.graphFor(site.tenantId), { url: site.url, tenantId: site.tenantId, tenantName: site.tenantName }, ctx.internalDomains,
            p => ctx.progress({ site: site.url, sitesDone: index, sitesTotal: sites.length, ...p }))
          await ctx.addLines(lines)
        } catch (error) {
          // Un site inaccessible n'arrête pas la collecte des autres : l'erreur est remontée dans le compte rendu.
          await ctx.siteError(site.url, error instanceof Error ? error.message : 'erreur inconnue')
        }
      }
      await ctx.progress({ sitesDone: sites.length, sitesTotal: sites.length })
    }
  }
}
