import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { sharepointSites, tenantConnections, users } from '../../db/schema'
import type { Database } from '../../utils/db'
import type { GraphClient } from '../../utils/graph'
import { CollectionStopped, type CollectionContext, type ControlModule } from '../types'
import { fetchSharingEvents, indexByObject, managerOf, matchAuthor, startSharingAuditQuery, waitForAuditQuery, type SharingEvent } from './authors'
import { collectSiteShares, type CollectedLine } from './collect'
import { ACCESS_LABELS } from './permissions'

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

/** Membres du tenant connus de l'annuaire synchronisé (la synchro ne retient que les comptes « Member »). */
export async function tenantMemberIds(db: Pick<Database, 'select'>, tenantId: string) {
  const rows = await db.select({ entraId: users.entraId }).from(users).where(eq(users.tenantId, tenantId))
  return new Set(rows.map(r => r.entraId.toLowerCase()))
}

export function sharepointModule(deps: SharepointDeps): ControlModule {
  return {
    async collect(ctx: CollectionContext) {
      const { siteIds } = sharepointConfigSchema.parse(ctx.config)
      const sites = await sessionSites(ctx.db, siteIds)
      if (!sites.length) throw new Error('Aucun site actif à analyser')
      if (!ctx.internalDomains.size) throw new Error('Aucun domaine interne paramétré')

      // Auteurs des partages : la recherche dans le journal d'audit est lancée tout de suite (elle prend plusieurs
      // minutes côté Microsoft) et exploitée une fois tous les sites parcourus.
      const tenants = [...new Set(sites.map(s => s.tenantId))]
      const auditQueries = new Map<string, string>()
      for (const tenantId of tenants) {
        try {
          auditQueries.set(tenantId, await startSharingAuditQuery(deps.graphFor(tenantId)))
        } catch (error) {
          await ctx.siteError(auditSource(sites, tenantId), error instanceof Error ? error.message : 'erreur inconnue')
        }
      }
      const collected: { tenantId: string, line: CollectedLine }[] = []

      const membersByTenant = new Map<string, Set<string>>()
      for (const [index, site] of sites.entries()) {
        try {
          let memberIds = membersByTenant.get(site.tenantId)
          if (!memberIds) {
            memberIds = await tenantMemberIds(ctx.db, site.tenantId)
            membersByTenant.set(site.tenantId, memberIds)
          }
          const { lines, fullControl } = await collectSiteShares(deps.graphFor(site.tenantId), { url: site.url, tenantId: site.tenantId, tenantName: site.tenantName, memberIds }, ctx.internalDomains,
            p => ctx.progress({ site: site.url, sitesDone: index, sitesTotal: sites.length, ...p }))
          await ctx.addLines(lines)
          collected.push(...lines.map(line => ({ tenantId: site.tenantId, line })))
          if (!fullControl) {
            await ctx.siteError(site.url, 'Contrôle total non accordé à l\'application sur ce site : les partages de dossiers et de fichiers peuvent manquer (voir Paramètres)')
          }
        } catch (error) {
          if (error instanceof CollectionStopped) throw error
          // Un site inaccessible n'arrête pas la collecte des autres : l'erreur est remontée dans le compte rendu.
          await ctx.siteError(site.url, error instanceof Error ? error.message : 'erreur inconnue')
        }
      }
      await ctx.progress({ sitesDone: sites.length, sitesTotal: sites.length })

      for (const [tenantId, queryId] of auditQueries) {
        const lines = collected.filter(c => c.tenantId === tenantId).map(c => c.line)
        if (!lines.length) continue
        try {
          await ctx.progress({ authors: 'running' })
          const graph = deps.graphFor(tenantId)
          await waitForAuditQuery(graph, queryId, { onWait: () => ctx.progress({ authors: 'running' }) })
          const patches = await authorPatches(ctx.db, graph, tenantId, lines, await fetchSharingEvents(graph, queryId))
          await ctx.annotateLines(patches)
          await ctx.progress({ authors: 'done', authorsFound: patches.filter(p => p.data.sharedBy).length })
        } catch (error) {
          if (error instanceof CollectionStopped) throw error
          await ctx.progress({ authors: 'failed' })
          await ctx.siteError(auditSource(sites, tenantId), error instanceof Error ? error.message : 'erreur inconnue')
        }
      }
    }
  }
}

const auditSource = (sites: { tenantId: string, tenantName: string }[], tenantId: string) =>
  `Journal d'audit (${sites.find(s => s.tenantId === tenantId)?.tenantName ?? tenantId})`

/**
 * Auteur de chaque partage d'après l'audit, et son N+1 dans l'annuaire, proposé comme valideur
 * (simple suggestion : l'admin décide toujours de l'assignation).
 */
export async function authorPatches(
  db: Pick<Database, 'select'>,
  graph: GraphClient,
  tenantId: string,
  lines: CollectedLine[],
  events: SharingEvent[]
) {
  const index = indexByObject(events)
  const managers = new Map<string, { entraId: string, displayName: string } | null>()
  const patches: { dedupKey: string, data: Record<string, string> }[] = []
  for (const line of lines) {
    if (!line.data.objectUrl) continue
    const match = matchAuthor({
      objectUrl: line.data.objectUrl,
      beneficiaryEmail: line.data.beneficiaryEmail ?? '',
      anonymous: line.data.access === ACCESS_LABELS.anonymous
    }, index)
    if (!match) continue
    if (!managers.has(match.author)) {
      managers.set(match.author, await managerOf(graph, match.author).catch(() => null))
    }
    const manager = managers.get(match.author)
    const [validator] = manager
      ? await db.select({ id: users.id, displayName: users.displayName }).from(users)
          .where(and(eq(users.tenantId, tenantId), eq(users.entraId, manager.entraId), eq(users.accountEnabled, true)))
      : []
    patches.push({
      dedupKey: line.dedupKey,
      data: {
        sharedBy: match.author,
        sharedAt: match.createdAt,
        sharedByCertain: match.certain ? 'yes' : 'no',
        ...(validator ? { suggestedValidatorId: validator.id, suggestedValidatorName: validator.displayName } : {})
      }
    })
  }
  return patches
}
