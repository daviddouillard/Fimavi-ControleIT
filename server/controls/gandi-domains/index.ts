import type { GandiClient, GandiDomain } from '../../utils/gandi'
import { gandiAccessMessage } from '../../utils/gandi'
import { CollectionStopped, type CollectionContext, type ControlLine, type ControlModule } from '../types'

export interface GandiDomainsDeps {
  /** Client Gandi (jeton de l'organisation) ; lève une erreur si le jeton n'est pas configuré. */
  gandi: () => GandiClient
}

/** Une ligne par nom de domaine : faut-il continuer à le renouveler ? */
export function domainLine(domain: GandiDomain): ControlLine {
  const name = domain.fqdn_unicode || domain.fqdn
  const data: Record<string, string> = { domain: name }
  if (domain.dates?.registry_ends_at) data.domainExpiresAt = domain.dates.registry_ends_at
  if (typeof domain.autorenew === 'boolean') data.autorenew = domain.autorenew ? 'Activé' : 'Désactivé'
  if (domain.domain_owner) data.domainOwner = domain.domain_owner
  if (domain.tld) data.tld = domain.tld
  return { dedupKey: `gandi|${domain.fqdn.toLowerCase()}`, label: name, data }
}

/** Ordre de collecte : échéances les plus proches d'abord. */
function byExpiry(a: GandiDomain, b: GandiDomain): number {
  return (a.dates?.registry_ends_at ?? '9999').localeCompare(b.dates?.registry_ends_at ?? '9999')
}

/** Noms de domaine de l'organisation Gandi, avec leur échéance. Lecture seule. */
export function gandiDomainsModule(deps: GandiDomainsDeps): ControlModule {
  return {
    async collect(ctx: CollectionContext) {
      await ctx.progress({ site: 'Gandi', sitesDone: 0, sitesTotal: 1 })
      try {
        const domains = (await deps.gandi().listDomains()).sort(byExpiry)
        await ctx.addLines(domains.map(domainLine))
        await ctx.progress({ sitesDone: 1, sitesTotal: 1, domainsTotal: domains.length })
      } catch (error) {
        if (error instanceof CollectionStopped) throw error
        await ctx.siteError('Gandi', gandiAccessMessage(error))
      }
    }
  }
}
