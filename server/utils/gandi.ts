import { z } from 'zod'
import { GraphError, MAX_ATTEMPTS, retryDelay, sleep } from './graph'

/**
 * API Gandi v5 en lecture : liste des noms de domaine de l'organisation et leur échéance.
 * Jeton d'accès personnel (PAT) Gandi, limité à une organisation, en variable d'environnement NUXT_GANDI_TOKEN
 * (Secret Manager en production). L'application ne modifie jamais rien chez Gandi.
 */
export const GANDI_ROOT = 'https://api.gandi.net/v5/'
const DOMAINS_URL = `${GANDI_ROOT}domain/domains`
const PER_PAGE = 100
/** Garde-fou contre une pagination sans fin (100 000 domaines). */
const MAX_PAGES = 1000

export class GandiError extends GraphError {}

const domainSchema = z.object({
  fqdn: z.string().min(1),
  fqdn_unicode: z.string().optional(),
  tld: z.string().optional(),
  autorenew: z.boolean().nullish(),
  domain_owner: z.string().nullish(),
  orga_owner: z.string().nullish(),
  status: z.array(z.string()).nullish(),
  dates: z.object({ registry_ends_at: z.string().nullish() }).loose().nullish()
}).loose()
export type GandiDomain = z.infer<typeof domainSchema>

export interface GandiClient {
  listDomains: () => Promise<GandiDomain[]>
}

export function gandiClient(token: string, deps: { fetch?: typeof fetch } = {}): GandiClient {
  const fetchImpl = deps.fetch ?? fetch
  if (!token) throw new GandiError(0, 'Jeton Gandi non configuré (NUXT_GANDI_TOKEN)', null)

  async function get(url: string): Promise<Response> {
    // Le jeton n'est envoyé qu'à l'API Gandi.
    if (!url.startsWith(GANDI_ROOT)) throw new Error('URL Gandi inattendue')
    for (let attempt = 1; ; attempt++) {
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
      if (res.ok) return res
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < MAX_ATTEMPTS) {
        await sleep(retryDelay(res, attempt))
        continue
      }
      // Seul le statut est conservé : jamais le jeton ni le détail de la réponse.
      throw new GandiError(res.status, `Lecture Gandi en échec (${res.status})`, null)
    }
  }

  return {
    async listDomains() {
      const domains: GandiDomain[] = []
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await get(`${DOMAINS_URL}?per_page=${PER_PAGE}&page=${page}`)
        const items = z.array(domainSchema).parse(await res.json())
        domains.push(...items)
        const total = Number(res.headers.get('Total-Count'))
        if (items.length < PER_PAGE || (Number.isFinite(total) && total > 0 && domains.length >= total)) break
      }
      return domains
    }
  }
}

/** Message compréhensible pour l'IT en cas d'échec de lecture Gandi. */
export function gandiAccessMessage(error: unknown): string {
  if (error instanceof GandiError) {
    if (error.status === 0) return error.message
    if (error.status === 401 || error.status === 403) {
      return 'Jeton Gandi refusé : il a expiré, a été révoqué ou n\'a pas le droit de voir les noms de domaine. Créez un nouveau jeton dans Gandi et mettez-le à jour dans Secret Manager.'
    }
    return error.message
  }
  return 'Lecture Gandi impossible'
}
