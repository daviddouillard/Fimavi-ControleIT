import { useRuntimeConfig } from 'nuxt/server'
import { z } from 'zod'

export const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0/'

const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number() })

const graphUserSchema = z.object({
  id: z.string(),
  displayName: z.string().nullable(),
  mail: z.string().nullable(),
  userPrincipalName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  department: z.string().nullable(),
  accountEnabled: z.boolean().nullable()
})

export type GraphUser = z.infer<typeof graphUserSchema>

export class GraphError extends Error {
  /**
   * @param code code d'erreur Microsoft, sans donnée sensible : « AADSTS… » pour un jeton refusé,
   *   code Graph (ex. « accessDenied ») pour un appel refusé.
   */
  constructor(public readonly status: number, message: string, public readonly code: string | null = null) {
    super(message)
  }
}

/** Jeton applicatif refusé par Entra pour un tenant (ID inconnu, application non consentie, secret invalide…). */
export class TokenError extends GraphError {}

const tokenErrorSchema = z.object({ error_codes: z.array(z.number()).optional(), error: z.string().optional() }).loose()
const graphErrorSchema = z.object({ error: z.object({ code: z.string().optional() }).loose().optional() }).loose()

/** Code d'erreur lisible d'une réponse en échec ; le corps complet n'est jamais conservé (il peut citer des données). */
async function errorCode(res: Response, kind: 'token' | 'graph'): Promise<string | null> {
  try {
    const body = await res.json() as unknown
    if (kind === 'token') {
      const parsed = tokenErrorSchema.safeParse(body)
      const code = parsed.success ? parsed.data.error_codes?.[0] : undefined
      return code ? `AADSTS${code}` : parsed.success ? parsed.data.error ?? null : null
    }
    const parsed = graphErrorSchema.safeParse(body)
    return parsed.success ? parsed.data.error?.code ?? null : null
  } catch {
    return null
  }
}

/** Accès Graph d'un tenant : lecture d'une ressource et parcours de toutes ses pages. */
export interface GraphClient {
  get: (pathOrUrl: string) => Promise<unknown>
  /**
   * Toutes les pages d'une collection (suivi de @odata.nextLink, puis du deltaLink final ignoré).
   * Les en-têtes éventuels (ex. Prefer) sont renvoyés à chaque page.
   */
  list: (pathOrUrl: string, options?: { headers?: Record<string, string> }) => AsyncGenerator<unknown[]>
  /** Corps JSON de la réponse, ou null si elle est vide (ex. 202 de sendMail). */
  post: (path: string, body: unknown) => Promise<unknown>
}

const tokens = new Map<string, { value: string, expiresAt: number }>()

/**
 * Jeton applicatif (client credentials) pour un tenant donné. Dans un tenant filiale, il n'est délivré
 * qu'après le consentement administrateur de ce tenant (app registration multi-locataire).
 */
async function getAppToken(tenant: string): Promise<string> {
  const cached = tokens.get(tenant)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value

  const { clientId, clientSecret } = useRuntimeConfig().oauth.microsoft
  if (!clientId || !clientSecret) throw new Error('Configuration Entra incomplète')

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default'
    })
  })
  if (!res.ok) {
    const code = await errorCode(res, 'token')
    throw new TokenError(res.status, `Jeton Graph refusé pour le tenant (${res.status}${code ? `, ${code}` : ''}) : ID de tenant ou consentement administrateur à vérifier`, code)
  }
  const token = tokenSchema.parse(await res.json())
  tokens.set(tenant, { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 })
  return token.access_token
}

const MAX_ATTEMPTS = 6
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Délai demandé par Graph (Retry-After, en secondes), sinon attente exponentielle plafonnée. */
function retryDelay(res: Response, attempt: number): number {
  const header = Number(res.headers.get('retry-after'))
  const seconds = Number.isFinite(header) && header > 0 ? header : 2 ** attempt
  // Plafonné : une collecte doit donner signe de vie bien avant d'être déclarée interrompue (10 min).
  return Math.min(seconds, 60) * 1000
}

export function graphClient(tenant: string, fetchImpl: typeof fetch = fetch): GraphClient {
  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    // On ne suit que des URL Graph (liens de pagination compris) : le jeton n'est jamais envoyé ailleurs.
    if (!url.startsWith(GRAPH_ROOT)) throw new Error('URL Graph inattendue')
    for (let attempt = 1; ; attempt++) {
      const token = await getAppToken(tenant)
      const res = await fetchImpl(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } })
      if (res.ok) return res
      // Jeton obtenu avant un changement de permissions (ex. consentement admin) : on le redemandera.
      if (res.status === 401 || res.status === 403) tokens.delete(tenant)
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < MAX_ATTEMPTS) {
        await sleep(retryDelay(res, attempt))
        continue
      }
      const code = await errorCode(res, 'graph')
      throw new GraphError(res.status, `Appel Graph en échec (${res.status}${code ? `, ${code}` : ''})`, code)
    }
  }

  const absolute = (pathOrUrl: string) => pathOrUrl.startsWith('https://') ? pathOrUrl : GRAPH_ROOT + pathOrUrl.replace(/^\//, '')

  return {
    async get(pathOrUrl) {
      return (await request(absolute(pathOrUrl))).json()
    },
    async* list(pathOrUrl, options = {}) {
      let url: string | undefined = absolute(pathOrUrl)
      while (url) {
        const page = z.object({ 'value': z.array(z.unknown()), '@odata.nextLink': z.string().optional() })
          .parse(await (await request(url, { headers: options.headers })).json())
        yield page.value
        url = page['@odata.nextLink']
      }
    },
    async post(path, body) {
      const res = await request(absolute(path), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const text = await res.text()
      return text ? JSON.parse(text) as unknown : null
    }
  }
}

/** Liste tous les comptes membres (hors invités) d'un tenant. */
export async function listDirectoryMembers(tenant: string): Promise<GraphUser[]> {
  const select = 'id,displayName,mail,userPrincipalName,jobTitle,department,accountEnabled'
  const result: GraphUser[] = []
  for await (const page of graphClient(tenant).list(`users?$select=${select}&$filter=userType eq 'Member'&$top=999`)) {
    result.push(...z.array(graphUserSchema).parse(page))
  }
  return result
}
