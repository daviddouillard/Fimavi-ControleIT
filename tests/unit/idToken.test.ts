import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { hasRole, verifyIdToken } from '../../server/utils/idToken'

const tenant = '11111111-1111-1111-1111-111111111111'
const clientId = '22222222-2222-2222-2222-222222222222'
const nonce = 'nonce-123'
const expected = { clientId, tenant, nonce }

let sign: (claims: Record<string, unknown>, opts?: { expiresIn?: string, issuer?: string, audience?: string }) => Promise<string>
let keys: ReturnType<typeof createLocalJWKSet>
let foreignSign: typeof sign

async function signer() {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: crypto.randomUUID(), alg: 'RS256' }
  const fn: typeof sign = (claims, opts = {}) => new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
    .setIssuer(opts.issuer ?? `https://login.microsoftonline.com/${tenant}/v2.0`)
    .setAudience(opts.audience ?? clientId)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '1h')
    .sign(privateKey)
  return { fn, jwk }
}

const baseClaims = { tid: tenant, oid: 'user-oid', nonce, name: 'Jane Doe', roles: ['IT.Admin'] }

beforeAll(async () => {
  const trusted = await signer()
  sign = trusted.fn
  keys = createLocalJWKSet({ keys: [trusted.jwk] })
  foreignSign = (await signer()).fn
})

describe('verifyIdToken', () => {
  it('accepte un jeton signé et conforme', async () => {
    const claims = await verifyIdToken(await sign(baseClaims), expected, keys)
    expect(claims.oid).toBe('user-oid')
  })

  it('refuse un jeton signé par une autre clé', async () => {
    await expect(verifyIdToken(await foreignSign(baseClaims), expected, keys)).rejects.toThrow()
  })

  it('refuse une signature altérée', async () => {
    const token = await sign(baseClaims)
    const [h, , s] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...baseClaims, roles: ['IT.Admin', 'x'], aud: clientId })).toString('base64url')
    await expect(verifyIdToken(`${h}.${forged}.${s}`, expected, keys)).rejects.toThrow()
  })

  it.each([
    ['audience', { audience: 'autre-app' }],
    ['émetteur', { issuer: 'https://evil.example.com/v2.0' }],
    ['expiration', { expiresIn: '-5m' }]
  ])('refuse un jeton avec %s invalide', async (_label, opts) => {
    await expect(verifyIdToken(await sign(baseClaims, opts), expected, keys)).rejects.toThrow()
  })

  it('refuse un tenant ou un nonce différent', async () => {
    await expect(verifyIdToken(await sign({ ...baseClaims, tid: 'autre' }), expected, keys)).rejects.toThrow('tenant')
    await expect(verifyIdToken(await sign({ ...baseClaims, nonce: 'rejoué' }), expected, keys)).rejects.toThrow('nonce')
  })

  it('refuse un jeton mal formé', async () => {
    await expect(verifyIdToken('abc', expected, keys)).rejects.toThrow()
  })
})

describe('hasRole', () => {
  it('détecte le rôle administrateur', () => {
    expect(hasRole({ roles: ['IT.Admin'] }, 'IT.Admin')).toBe(true)
    expect(hasRole({ roles: ['Autre'] }, 'IT.Admin')).toBe(false)
    expect(hasRole({}, 'IT.Admin')).toBe(false)
  })

  it("ne donne jamais le rôle si NUXT_ADMIN_ROLE n'est pas configuré", () => {
    expect(hasRole({ roles: [''] }, '')).toBe(false)
  })
})
