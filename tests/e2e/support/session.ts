// Fabrique un cookie de session nuxt-auth-utils valide, scellé avec le secret généré pour les tests.
// Reproduit le format de nuxt/server (session.js / secret.js, Nuxt 4.6) : si ce format change, les tests connectés
// échouent explicitement plutôt que de passer à tort.
import type { BrowserContext } from '@playwright/test'
import { defaults, seal } from 'iron-webcrypto'

const COOKIE_NAME = 'nuxt-auth-session'

async function deriveSecret(appSecret: string, purpose: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(appSecret), 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('nuxt'), info: encoder.encode(purpose) }, key, 256)
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export interface SessionUser { id: string, entraId: string, name: string, email: string, isAdmin: boolean }

export async function loginAs(context: BrowserContext, baseURL: string, user: SessionUser) {
  const appSecret = process.env.E2E_APP_SECRET
  if (!appSecret) throw new Error('E2E_APP_SECRET absent')
  const password = await deriveSecret(appSecret, `nuxt-session:${COOKIE_NAME}`)
  const sealed = await seal(
    { nuxt: 1, id: crypto.randomUUID(), data: { user, loggedInAt: new Date().toISOString() } },
    password,
    { ...defaults, ttl: 60 * 60 * 1000 }
  )
  await context.clearCookies()
  await context.addCookies([{ name: COOKIE_NAME, value: sealed, url: baseURL, httpOnly: true, sameSite: 'Lax' }])
}
