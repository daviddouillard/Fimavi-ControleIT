import { z } from 'zod'
import { GraphError, type GraphClient } from '../../utils/graph'
import { ACCESS_LABELS, externalGrants, ROLE_LABELS, type ExternalGrant } from './permissions'

/**
 * Collecte des partages externes d'un site SharePoint via Microsoft Graph (lecture seule, Sites.Read.All).
 *
 * Pour chaque bibliothèque du site : parcours de tous les éléments (delta avec « Prefer: hierarchicalsharing »), puis
 * lecture des permissions de la racine et des éléments porteurs de la facette `shared`. Avec cet en-tête, la facette
 * marque chaque élément qui a ses propres permissions (racine d'une hiérarchie de partage, même sans lien).
 * Graph ne la renvoie de façon fiable qu'avec le contrôle total sur le site : l'application le reçoit site par site
 * (Sites.Selected + rôle fullcontrol, voir infra/grant-site-fullcontrol.ps1). Sans lui, la collecte le signale.
 * SharePoint ne renvoie pas `inheritedFrom` : un partage déjà présent sur un dossier parent analysé est considéré
 * comme hérité et n'est pas répété.
 */

export interface SiteTarget {
  url: string
  tenantId: string
  tenantName: string
  /** Identifiants Entra (minuscules) des membres du tenant : jamais considérés comme externes. */
  memberIds?: ReadonlySet<string>
}

export interface CollectedLine {
  dedupKey: string
  label: string
  data: Record<string, string>
}

const siteSchema = z.object({ id: z.string(), displayName: z.string().nullish(), webUrl: z.string().nullish() })
const driveSchema = z.object({ id: z.string(), name: z.string().nullish(), webUrl: z.string().nullish(), driveType: z.string().nullish() })
const driveItemSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  webUrl: z.string().nullish(),
  parentReference: z.object({ id: z.string().nullish() }).nullish(),
  folder: z.object({}).loose().nullish(),
  root: z.object({}).loose().nullish(),
  shared: z.object({}).loose().nullish(),
  deleted: z.object({}).loose().nullish()
})

/** Forme réduite conservée en mémoire pendant le parcours d'une bibliothèque. */
interface DriveItem {
  id: string
  name: string | null
  webUrl: string | null
  parentId: string | null
  folder: boolean
  root: boolean
  shared: boolean
}

/** Au-delà, la bibliothèque est signalée en erreur plutôt que de saturer la mémoire de l'instance. */
export const MAX_ITEMS_PER_DRIVE = 400_000

/** Chemin Graph « sites/{hôte}:/sites/{nom} » d'une URL de site normalisée. */
export function sitePath(url: string): string {
  const { hostname, pathname } = new URL(url)
  const path = pathname.replace(/\/+$/, '')
  return path ? `sites/${hostname}:${path.split('/').map(encodeURIComponent).join('/')}` : `sites/${hostname}`
}

/** Exécute les tâches avec un parallélisme limité (respect du throttling Graph). */
async function pool<T>(items: T[], size: number, task: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await task(items[next++]!)
  }))
}

export async function resolveSite(graph: GraphClient, url: string) {
  return siteSchema.parse(await graph.get(`${sitePath(url)}?$select=id,displayName,webUrl`))
}

/**
 * L'application a-t-elle le contrôle total sur le site ? La liste des permissions applicatives du site
 * n'est accessible qu'avec ce niveau de droit ; un refus (401/403) signifie lecture seule.
 */
export async function hasFullControl(graph: GraphClient, siteId: string): Promise<boolean> {
  try {
    await graph.get(`sites/${encodeURIComponent(siteId)}/permissions?$top=1`)
    return true
  } catch (error) {
    if (error instanceof GraphError && (error.status === 401 || error.status === 403)) return false
    throw error
  }
}

export interface SiteShares {
  lines: CollectedLine[]
  /** Faux : contrôle total non accordé, des partages de dossiers ou fichiers peuvent manquer. */
  fullControl: boolean
}

export interface CollectProgress {
  drivesDone: number
  drivesTotal: number
  itemsScanned: number
  /** Éléments partagés dont les permissions ont été lues / à lire, pour la bibliothèque en cours. */
  permissionsChecked: number
  permissionsTotal: number
}

export async function collectSiteShares(
  graph: GraphClient,
  target: SiteTarget,
  internalDomains: ReadonlySet<string>,
  onProgress: (p: CollectProgress) => Promise<void> | void = () => {}
): Promise<SiteShares> {
  const site = await resolveSite(graph, target.url)
  const siteName = site.displayName ?? target.url
  const fullControl = await hasFullControl(graph, site.id)

  const drives: z.infer<typeof driveSchema>[] = []
  for await (const page of graph.list(`sites/${encodeURIComponent(site.id)}/drives?$select=id,name,webUrl,driveType`)) {
    drives.push(...z.array(driveSchema).parse(page))
  }

  const lines = new Map<string, CollectedLine>()
  const progress: CollectProgress = { drivesDone: 0, drivesTotal: drives.length, itemsScanned: 0, permissionsChecked: 0, permissionsTotal: 0 }
  await onProgress(progress)

  for (const drive of drives) {
    const driveName = drive.name ?? 'Documents'
    const items = new Map<string, DriveItem>()
    const select = 'id,name,webUrl,parentReference,folder,root,shared,deleted'
    for await (const page of graph.list(`drives/${encodeURIComponent(drive.id)}/root/delta?$select=${select}`, { headers: { Prefer: 'hierarchicalsharing' } })) {
      for (const raw of page) {
        const parsed = driveItemSchema.safeParse(raw)
        if (!parsed.success) continue
        const d = parsed.data
        // Un même élément peut apparaître plusieurs fois dans le delta : la dernière occurrence fait foi.
        if (d.deleted) {
          items.delete(d.id)
          continue
        }
        items.set(d.id, { id: d.id, name: d.name ?? null, webUrl: d.shared || d.root ? d.webUrl ?? null : null, parentId: d.parentReference?.id ?? null, folder: !!d.folder, root: !!d.root, shared: !!d.shared })
      }
      if (items.size > MAX_ITEMS_PER_DRIVE) throw new Error(`Bibliothèque « ${driveName} » trop volumineuse (plus de ${MAX_ITEMS_PER_DRIVE} éléments)`)
      progress.itemsScanned += page.length
      await onProgress(progress)
    }

    const path = (item: DriveItem): string => {
      const parts: string[] = []
      let current: DriveItem | undefined = item
      for (let guard = 0; current && !current.root && guard < 500; guard++) {
        parts.unshift(current.name ?? '?')
        current = current.parentId ? items.get(current.parentId) : undefined
      }
      return [driveName, ...parts].join(' / ')
    }
    const depth = (item: DriveItem) => path(item).split(' / ').length

    // Racine de la bibliothèque + éléments partagés, des plus hauts aux plus profonds (héritage).
    const candidates = [...items.values()].filter(i => i.root || i.shared).sort((a, b) => depth(a) - depth(b))
    const grantsByItem = new Map<string, ExternalGrant[]>()
    progress.permissionsChecked = 0
    progress.permissionsTotal = candidates.length
    await onProgress(progress)
    await pool(candidates, 4, async (item) => {
      const grants: ExternalGrant[] = []
      for await (const page of graph.list(`drives/${encodeURIComponent(drive.id)}/items/${encodeURIComponent(item.id)}/permissions`)) {
        for (const permission of page) grants.push(...externalGrants(permission, internalDomains, target.memberIds))
      }
      grantsByItem.set(item.id, grants)
      if (++progress.permissionsChecked % 25 === 0) await onProgress(progress)
    })

    const nearestAnalyzedAncestor = (item: DriveItem): DriveItem | undefined => {
      let current = item.parentId ? items.get(item.parentId) : undefined
      for (let guard = 0; current && guard < 500; guard++) {
        if (grantsByItem.has(current.id)) return current
        current = current.parentId ? items.get(current.parentId) : undefined
      }
      return undefined
    }

    for (const item of candidates) {
      const ancestor = nearestAnalyzedAncestor(item)
      const inherited = new Set((ancestor ? grantsByItem.get(ancestor.id) ?? [] : []).map(g => `${g.beneficiaryKey}|${g.role}`))
      const resourceType = item.root ? 'Bibliothèque' : item.folder ? 'Dossier' : 'Fichier'
      const resourcePath = path(item)
      for (const grant of grantsByItem.get(item.id) ?? []) {
        if (inherited.has(`${grant.beneficiaryKey}|${grant.role}`)) continue
        const dedupKey = ['sp', target.tenantId, drive.id, item.id, grant.beneficiaryKey, grant.role].join('|')
        lines.set(dedupKey, {
          dedupKey,
          label: `${resourcePath} → ${grant.beneficiary}`,
          data: {
            tenant: target.tenantName,
            site: siteName,
            siteUrl: site.webUrl ?? target.url,
            resourceType,
            resource: resourcePath,
            resourceUrl: item.webUrl ?? drive.webUrl ?? '',
            beneficiary: grant.beneficiary,
            beneficiaryEmail: grant.email ?? '',
            access: ACCESS_LABELS[grant.access],
            role: ROLE_LABELS[grant.role],
            expiresAt: grant.expiresAt ?? ''
          }
        })
      }
    }

    progress.drivesDone++
    await onProgress(progress)
  }

  return { lines: [...lines.values()], fullControl }
}
