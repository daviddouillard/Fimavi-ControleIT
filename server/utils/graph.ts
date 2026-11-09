import { useRuntimeConfig } from 'nuxt/server'
import { z } from 'zod'

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0/'

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
const usersPageSchema = z.object({
  'value': z.array(graphUserSchema),
  '@odata.nextLink': z.string().optional()
})

export type GraphUser = z.infer<typeof graphUserSchema>

let cachedToken: { value: string, expiresAt: number } | undefined

/** Jeton applicatif (client credentials) pour Microsoft Graph — permission User.Read.All. */
async function getAppToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value

  const { tenant, clientId, clientSecret } = useRuntimeConfig().oauth.microsoft
  if (!tenant || !clientId || !clientSecret) throw new Error('Configuration Entra incomplète')

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default'
    })
  })
  if (!res.ok) throw new Error(`Jeton Graph refusé (${res.status})`)
  const token = tokenSchema.parse(await res.json())
  cachedToken = { value: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 }
  return cachedToken.value
}

/** Liste tous les comptes membres (hors invités) du tenant. */
export async function listDirectoryMembers(): Promise<GraphUser[]> {
  const token = await getAppToken()
  const select = 'id,displayName,mail,userPrincipalName,jobTitle,department,accountEnabled'
  let url: string | undefined = `${GRAPH_ROOT}users?$select=${select}&$filter=userType eq 'Member'&$top=999`
  const result: GraphUser[] = []

  while (url) {
    // On ne suit que des liens de pagination pointant vers Graph.
    if (!url.startsWith(GRAPH_ROOT)) throw new Error('Lien de pagination Graph inattendu')
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    // Jeton obtenu avant un changement de permissions (ex. consentement admin) : on le redemandera au prochain appel.
    if (res.status === 401 || res.status === 403) cachedToken = undefined
    if (!res.ok) throw new Error(`Appel Graph en échec (${res.status})`)
    const page = usersPageSchema.parse(await res.json())
    result.push(...page.value)
    url = page['@odata.nextLink']
  }
  return result
}
