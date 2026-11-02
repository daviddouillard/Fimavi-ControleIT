import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'

const claimsSchema = z.object({
  aud: z.string(),
  iss: z.string(),
  tid: z.string(),
  oid: z.string(),
  exp: z.number(),
  nonce: z.string(),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
  email: z.string().optional(),
  roles: z.array(z.string()).optional()
})

export type IdTokenClaims = z.infer<typeof claimsSchema>

export interface IdTokenExpectations {
  clientId: string
  tenant: string
  nonce: string
}

const jwksByTenant = new Map<string, JWTVerifyGetKey>()

/** Clés publiques de signature Entra du tenant (mises en cache par jose). */
export function entraJwks(tenant: string): JWTVerifyGetKey {
  let jwks = jwksByTenant.get(tenant)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/discovery/v2.0/keys`))
    jwksByTenant.set(tenant, jwks)
  }
  return jwks
}

/**
 * Vérifie l'id_token Entra : signature (RS256, clés du tenant), émetteur, audience, expiration,
 * tenant et nonce de la requête d'autorisation.
 */
export async function verifyIdToken(idToken: string, expected: IdTokenExpectations, keys: JWTVerifyGetKey = entraJwks(expected.tenant)): Promise<IdTokenClaims> {
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: `https://login.microsoftonline.com/${expected.tenant}/v2.0`,
    audience: expected.clientId,
    algorithms: ['RS256'],
    clockTolerance: 60
  })
  const claims = claimsSchema.parse(payload)
  if (claims.tid !== expected.tenant) throw new Error('id_token : tenant invalide')
  if (claims.nonce !== expected.nonce) throw new Error('id_token : nonce invalide')
  return claims
}

export function hasRole(claims: Pick<IdTokenClaims, 'roles'>, role: string): boolean {
  return role.length > 0 && (claims.roles ?? []).includes(role)
}
