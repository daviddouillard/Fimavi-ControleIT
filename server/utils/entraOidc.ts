import { createHash, randomBytes } from 'node:crypto'
import { deleteCookie, getCookie, setCookie, useRuntimeConfig, type RequestEvent } from 'nuxt/server'
import { z } from 'zod'
import { verifyIdToken, type IdTokenClaims } from './idToken'

/**
 * Flux OIDC « authorization code » Entra ID avec state, nonce et PKCE (RFC 9700).
 * Remplace le gestionnaire Microsoft de nuxt-auth-utils, qui ne gère ni PKCE ni nonce.
 */

const COOKIE = 'controleit-oidc'
const COOKIE_PATH = '/auth/microsoft'

const pendingSchema = z.object({ state: z.string(), nonce: z.string(), verifier: z.string() })
const tokenResponseSchema = z.object({ id_token: z.string() })

const random = () => randomBytes(32).toString('base64url')

function entraConfig() {
  const { clientId, clientSecret, tenant, redirectURL } = useRuntimeConfig().oauth.microsoft
  if (!clientId || !clientSecret || !tenant || !redirectURL) throw new Error('Configuration Entra incomplète')
  return { clientId, clientSecret, tenant, redirectURL }
}

/** Prépare la redirection vers Entra et mémorise state/nonce/verifier dans un cookie court. */
export function buildAuthorizationUrl(event: RequestEvent): string {
  const config = entraConfig()
  const pending = { state: random(), nonce: random(), verifier: random() }

  setCookie(event, COOKIE, JSON.stringify(pending), {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: 600
  })

  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/authorize`)
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectURL,
    response_mode: 'query',
    scope: 'openid profile email',
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: createHash('sha256').update(pending.verifier).digest('base64url'),
    code_challenge_method: 'S256'
  }).toString()
  return url.toString()
}

/** Traite le retour d'Entra : vérifie le state, échange le code (PKCE) et valide l'id_token. */
export async function handleCallback(event: RequestEvent, query: { code?: string, state?: string }): Promise<IdTokenClaims> {
  const config = entraConfig()
  const raw = getCookie(event, COOKIE)
  deleteCookie(event, COOKIE, { path: COOKIE_PATH })

  const pending = raw ? pendingSchema.safeParse(JSON.parse(raw)) : undefined
  if (!pending?.success) throw new Error('Session de connexion absente ou expirée')
  if (!query.code || !query.state || query.state !== pending.data.state) throw new Error('state invalide')

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: query.code,
      redirect_uri: config.redirectURL,
      code_verifier: pending.data.verifier
    })
  })
  if (!res.ok) throw new Error(`Échange du code refusé (${res.status})`)
  const tokens = tokenResponseSchema.parse(await res.json())

  return verifyIdToken(tokens.id_token, { clientId: config.clientId, tenant: config.tenant, nonce: pending.data.nonce })
}
