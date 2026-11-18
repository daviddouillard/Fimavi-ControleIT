import { z } from 'zod'
import { GraphError, MAX_ATTEMPTS, retryDelay, sleep } from './graph'

/**
 * API Gandi v5 en lecture : noms de domaine, certificats SSL et hébergements web de l'organisation, avec leur échéance.
 * Jeton d'accès personnel (PAT) Gandi, limité à une organisation, en variable d'environnement NUXT_GANDI_TOKEN
 * (Secret Manager en production). L'application ne modifie jamais rien chez Gandi.
 */
export const GANDI_ROOT = 'https://api.gandi.net/v5/'
const DOMAINS_URL = `${GANDI_ROOT}domain/domains`
const CERTIFICATES_URL = `${GANDI_ROOT}certificate/issued-certs`
const HOSTINGS_URL = `${GANDI_ROOT}simplehosting/instances`
const PER_PAGE = 100
/** Garde-fou contre une pagination sans fin (100 000 éléments). */
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

const certificateSchema = z.object({
  id: z.string().min(1),
  cn: z.string().min(1),
  cn_unicode: z.string().nullish(),
  altnames: z.array(z.string()).nullish(),
  status: z.string().nullish(),
  package: z.object({ name: z.string().nullish(), name_label: z.string().nullish() }).loose().nullish(),
  dates: z.object({ ends_at: z.string().nullish() }).loose().nullish()
}).loose()
export type GandiCertificate = z.infer<typeof certificateSchema>

const hostingSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string().nullish(),
  size: z.string().nullish(),
  expire_at: z.string().nullish(),
  domain: z.string().nullish(),
  autorenew: z.object({}).loose().nullish()
}).loose()
export type GandiHosting = z.infer<typeof hostingSchema>

export interface GandiClient {
  listDomains: () => Promise<GandiDomain[]>
  listCertificates: () => Promise<GandiCertificate[]>
  listHostings: () => Promise<GandiHosting[]>
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

  /** Lit toutes les pages d'une liste (URL construite par l'application, jamais reprise de la réponse). */
  async function list<T>(baseUrl: string, schema: z.ZodType<T>): Promise<T[]> {
    const all: T[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await get(`${baseUrl}?per_page=${PER_PAGE}&page=${page}`)
      const items = z.array(schema).parse(await res.json())
      all.push(...items)
      const total = Number(res.headers.get('Total-Count'))
      if (items.length < PER_PAGE || (Number.isFinite(total) && total > 0 && all.length >= total)) break
    }
    return all
  }

  return {
    listDomains: () => list(DOMAINS_URL, domainSchema),
    listCertificates: () => list(CERTIFICATES_URL, certificateSchema),
    listHostings: () => list(HOSTINGS_URL, hostingSchema)
  }
}

/** Message compréhensible pour l'IT en cas d'échec de lecture Gandi ; `what` : ce que le jeton doit pouvoir voir. */
export function gandiAccessMessage(error: unknown, what = 'les noms de domaine'): string {
  if (error instanceof GandiError) {
    if (error.status === 0) return error.message
    if (error.status === 401 || error.status === 403) {
      return `Jeton Gandi refusé : il a expiré, a été révoqué ou n'a pas le droit de voir ${what}. Créez un nouveau jeton dans Gandi et mettez-le à jour dans Secret Manager.`
    }
    return error.message
  }
  return 'Lecture Gandi impossible'
}
