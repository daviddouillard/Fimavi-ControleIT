import { z } from 'zod'
import { forgetAppToken, getAppToken, GraphError, MAX_ATTEMPTS, retryDelay, sleep } from './graph'
import { isTenantGuid } from './tenants'

/**
 * Exchange Online en lecture : commandes Exchange (Get-Mailbox, Get-MailboxPermission, Get-RecipientPermission)
 * exécutées par le service web « InvokeCommand », celui qu'utilise le module PowerShell officiel
 * ExchangeOnlineManagement. Jeton applicatif (permission Exchange.ManageAsApp) ; les droits effectifs viennent du
 * rôle attribué à l'application dans chaque tenant (« Lecteur général » : lecture seule).
 * Point d'accès non documenté publiquement par Microsoft : il peut évoluer (voir docs/droits-et-autorisations.md).
 */
export const EXCHANGE_SCOPE = 'https://outlook.office365.com/.default'
export const EXCHANGE_ROOT = 'https://outlook.office365.com/adminapi/beta/'

/** Seules ces commandes, en lecture, peuvent être envoyées : l'application ne modifie jamais Exchange. */
const ALLOWED_CMDLETS = new Set(['Get-Mailbox', 'Get-MailboxPermission', 'Get-RecipientPermission'])

export class ExchangeError extends GraphError {}

export type ExchangeObject = Record<string, unknown>

export interface ExchangeClient {
  /** Résultats d'une commande en lecture (toutes les pages). `anchor` : boîte visée, pour l'aiguillage Exchange. */
  invoke: (cmdlet: string, parameters: Record<string, unknown>, anchor?: string) => Promise<ExchangeObject[]>
}

const pageSchema = z.object({ 'value': z.array(z.record(z.string(), z.unknown())), '@odata.nextLink': z.string().optional() }).loose()
const errorSchema = z.object({ error: z.object({ code: z.string().optional() }).loose().optional() }).loose()

async function errorCode(res: Response): Promise<string | null> {
  try {
    const parsed = errorSchema.safeParse(await res.json())
    return parsed.success ? parsed.data.error?.code ?? null : null
  } catch {
    return null
  }
}

/**
 * @param defaultAnchor adresse d'une boîte existante du tenant (en-tête X-AnchorMailbox des commandes sans boîte visée).
 * @param deps accès réseau et jeton (remplacés dans les tests).
 */
export function exchangeClient(
  tenant: string,
  defaultAnchor?: string,
  deps: { fetch?: typeof fetch, token?: (tenant: string) => Promise<string> } = {}
): ExchangeClient {
  const fetchImpl = deps.fetch ?? fetch
  const token = deps.token ?? ((t: string) => getAppToken(t, EXCHANGE_SCOPE))
  if (!isTenantGuid(tenant)) throw new Error('ID de tenant invalide')
  const endpoint = `${EXCHANGE_ROOT}${tenant.toLowerCase()}/InvokeCommand`

  async function request(url: string, cmdlet: string, body: string, anchor?: string): Promise<Response> {
    // Le jeton n'est envoyé qu'au service Exchange de ce tenant, liens de pagination compris.
    if (!url.startsWith(endpoint)) throw new Error('URL Exchange inattendue')
    const mailbox = anchor ?? defaultAnchor
    for (let attempt = 1; ; attempt++) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${await token(tenant)}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-ResponseFormat': 'json',
          'X-AnchorMailbox': mailbox ? `UPN:${mailbox}` : `APP:SystemMailbox{bb558c35-97f1-4cb9-8ff7-d53741dc928c}@${tenant}`
        },
        body
      })
      if (res.ok) return res
      if (res.status === 401 || res.status === 403) forgetAppToken(tenant, EXCHANGE_SCOPE)
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < MAX_ATTEMPTS) {
        await sleep(retryDelay(res, attempt))
        continue
      }
      // Seuls le statut et le code sont conservés : le détail cite des objets Exchange.
      const code = await errorCode(res)
      throw new ExchangeError(res.status, `Commande Exchange ${cmdlet} en échec (${res.status}${code ? `, ${code}` : ''})`, code)
    }
  }

  return {
    async invoke(cmdlet, parameters, anchor) {
      if (!ALLOWED_CMDLETS.has(cmdlet)) throw new Error(`Commande Exchange non autorisée : ${cmdlet}`)
      const body = JSON.stringify({ CmdletInput: { CmdletName: cmdlet, Parameters: parameters } })
      const results: ExchangeObject[] = []
      let url: string | undefined = endpoint
      while (url) {
        const page = pageSchema.parse(await (await request(url, cmdlet, body, anchor)).json())
        results.push(...page.value)
        url = page['@odata.nextLink']
      }
      return results
    }
  }
}
