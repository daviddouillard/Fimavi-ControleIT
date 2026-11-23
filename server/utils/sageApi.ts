import { z } from 'zod'
import { GraphError, MAX_ATTEMPTS, retryDelay, sleep } from './graph'

/**
 * API interne A3SreportingSage (fimapi2) en lecture : comptes Sage par personne et par dossier
 * (table GROUPE.dbo.LOGINS_SAGE, sans les mots de passe Sage, que l'API ne renvoie jamais).
 * Adresse de base en NUXT_SAGE_API_URL, clé X-API-KEY en NUXT_SAGE_API_KEY (Secret Manager en production).
 * fimapi2 filtre les adresses IP : en production, l'application sort par l'IP fixe du Cloud NAT.
 */
export const SAGE_ACCESS_PATH = 'DroitAcces/Get_DroitAccesGroupe'
const TIMEOUT_MS = 60_000
/** Garde-fou : bien au-delà du volume réel (environ 600 comptes). */
const MAX_LOGINS = 50_000

export class SageApiError extends GraphError {}

const loginSchema = z.object({
  ID_LOGIN_SAGE: z.union([z.number(), z.string()]).nullish(),
  PR_Nom: z.string().nullish(),
  id_ad: z.string().nullish(),
  site: z.union([z.number(), z.string()]).nullish(),
  IntituleDossier: z.string().nullish()
}).loose()
export type SageLogin = z.infer<typeof loginSchema>

export interface SageClient {
  listLogins: () => Promise<SageLogin[]>
}

/** Adresse de base validée : HTTPS obligatoire, terminée par « / ». */
export function sageBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SageApiError(0, 'Adresse de l\'API Sage invalide (NUXT_SAGE_API_URL)', null)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new SageApiError(0, 'Adresse de l\'API Sage invalide : HTTPS sans identifiant ni paramètre (NUXT_SAGE_API_URL)', null)
  }
  return url.toString().replace(/\/?$/, '/')
}

export function sageClient(config: { url: string, key: string }, deps: { fetch?: typeof fetch } = {}): SageClient {
  const fetchImpl = deps.fetch ?? fetch
  if (!config.url || !config.key) throw new SageApiError(0, 'API Sage non configurée (NUXT_SAGE_API_URL, NUXT_SAGE_API_KEY)', null)
  // La clé n'est envoyée qu'à cette adresse fixe, construite par l'application.
  const url = sageBaseUrl(config.url) + SAGE_ACCESS_PATH

  return {
    async listLogins() {
      for (let attempt = 1; ; attempt++) {
        let res: Response
        try {
          res = await fetchImpl(url, {
            headers: { 'X-API-KEY': config.key, 'Accept': 'application/json' },
            redirect: 'error',
            signal: AbortSignal.timeout(TIMEOUT_MS)
          })
        } catch {
          // Délai dépassé ou serveur injoignable (IP non autorisée par fimapi2, réseau) : jamais la clé dans le message.
          throw new SageApiError(0, 'API Sage injoignable (réseau, délai dépassé ou adresse IP non autorisée)', null)
        }
        if (res.ok) return z.array(loginSchema).max(MAX_LOGINS).parse(await res.json())
        if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < Math.min(MAX_ATTEMPTS, 3)) {
          await sleep(retryDelay(res, attempt))
          continue
        }
        throw new SageApiError(res.status, `Lecture de l'API Sage en échec (${res.status})`, null)
      }
    }
  }
}

/** Message compréhensible pour l'IT en cas d'échec de lecture de l'API Sage. */
export function sageAccessMessage(error: unknown): string {
  if (error instanceof SageApiError) {
    if (error.status === 401 || error.status === 403) return 'Clé de l\'API Sage refusée : vérifier la clé A3SreportingSage (table ApiKeys) et le secret NUXT_SAGE_API_KEY.'
    return error.message
  }
  if (error instanceof z.ZodError) return 'Réponse de l\'API Sage inattendue'
  return 'Lecture de l\'API Sage impossible'
}
