import type { GandiCertificate, GandiClient, GandiDomain, GandiHosting } from '../../utils/gandi'
import { gandiAccessMessage } from '../../utils/gandi'
import { CollectionStopped, type CollectionContext, type ControlLine, type ControlModule } from '../types'

export interface GandiDomainsDeps {
  /** Client Gandi (jeton de l'organisation) ; lève une erreur si le jeton n'est pas configuré. */
  gandi: () => GandiClient
}

/**
 * Services Gandi : une ligne par service payant (nom de domaine, certificat SSL, hébergement web) — faut-il le renouveler ?
 * Champs communs : `domain` (nom affiché), `domainExpiresAt` (échéance), `gandiKind` (type de service, absent pour un domaine).
 */
export const GANDI_KINDS = { certificate: 'Certificat SSL', hosting: 'Hébergement web' } as const

/** Certificats sans renouvellement à décider : expirés, révoqués ou remplacés. */
const INACTIVE_CERTIFICATES = new Set(['expired', 'revoked', 'replaced', 'replaced_rev'])

export function domainLine(domain: GandiDomain): ControlLine {
  const name = domain.fqdn_unicode || domain.fqdn
  const data: Record<string, string> = { domain: name }
  if (domain.dates?.registry_ends_at) data.domainExpiresAt = domain.dates.registry_ends_at
  if (typeof domain.autorenew === 'boolean') data.autorenew = domain.autorenew ? 'Activé' : 'Désactivé'
  if (domain.domain_owner) data.domainOwner = domain.domain_owner
  if (domain.tld) data.tld = domain.tld
  return { dedupKey: `gandi|${domain.fqdn.toLowerCase()}`, label: name, data }
}

export function certificateLine(cert: GandiCertificate): ControlLine {
  const name = cert.cn_unicode || cert.cn
  const data: Record<string, string> = { domain: name, gandiKind: GANDI_KINDS.certificate }
  if (cert.dates?.ends_at) data.domainExpiresAt = cert.dates.ends_at
  const product = cert.package?.name_label || cert.package?.name
  if (product) data.product = product
  const others = (cert.altnames ?? []).filter(n => n.toLowerCase() !== cert.cn.toLowerCase())
  if (others.length) data.altnames = others.join(', ')
  return { dedupKey: `gandi-cert|${cert.id}`, label: name, data }
}

export function hostingLine(hosting: GandiHosting): ControlLine {
  const data: Record<string, string> = { domain: hosting.name, gandiKind: GANDI_KINDS.hosting }
  if (hosting.expire_at) data.domainExpiresAt = hosting.expire_at
  data.autorenew = hosting.autorenew ? 'Activé' : 'Désactivé'
  if (hosting.size) data.product = `Taille ${hosting.size.toUpperCase()}`
  if (hosting.domain) data.hostingDomain = hosting.domain
  return { dedupKey: `gandi-hosting|${hosting.id}`, label: hosting.name, data }
}

/** Ordre de collecte : échéances les plus proches d'abord. */
function byExpiry(a: ControlLine, b: ControlLine): number {
  return (a.data.domainExpiresAt ?? '9999').localeCompare(b.data.domainExpiresAt ?? '9999')
}

/** Noms de domaine, certificats SSL et hébergements web de l'organisation Gandi, avec leur échéance. Lecture seule. */
export function gandiDomainsModule(deps: GandiDomainsDeps): ControlModule {
  return {
    async collect(ctx: CollectionContext) {
      const sources = [
        { name: 'Gandi — noms de domaine', what: 'les noms de domaine', read: async (c: GandiClient) => (await c.listDomains()).map(domainLine) },
        {
          name: 'Gandi — certificats SSL',
          what: 'les certificats SSL',
          read: async (c: GandiClient) => (await c.listCertificates()).filter(x => !INACTIVE_CERTIFICATES.has(x.status ?? '')).map(certificateLine)
        },
        {
          name: 'Gandi — hébergements web',
          what: 'les hébergements web (Simple Hosting)',
          read: async (c: GandiClient) => (await c.listHostings()).filter(x => x.status !== 'being_deleted').map(hostingLine)
        }
      ]
      const lines: ControlLine[] = []
      let sitesDone = 0
      for (const source of sources) {
        await ctx.progress({ site: source.name, sitesDone, sitesTotal: sources.length })
        try {
          lines.push(...await source.read(deps.gandi()))
        } catch (error) {
          if (error instanceof CollectionStopped) throw error
          await ctx.siteError(source.name, gandiAccessMessage(error, source.what))
        }
        sitesDone++
      }
      lines.sort(byExpiry)
      await ctx.addLines(lines)
      await ctx.progress({ sitesDone, sitesTotal: sources.length, domainsTotal: lines.length })
    }
  }
}
