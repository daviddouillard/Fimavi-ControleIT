import { and, eq } from 'drizzle-orm'
import { createError, type RequestEvent } from 'nuxt/server'
import { users } from '../db/schema'
import { useDb } from './db'
import { allowedTenants, homeTenant } from './tenants'

/**
 * Exige un utilisateur connecté (401 sinon).
 * Le compte est revérifié en base à chaque requête : un compte désactivé à la synchro Entra, ou dont le tenant
 * a été désactivé dans les paramètres, perd l'accès immédiatement.
 */
export async function requireUser(event: RequestEvent) {
  const { user } = await requireUserSession(event, { status: 401, message: 'Authentification requise' })
  const db = useDb()
  const [active] = await db.select({ tenantId: users.tenantId }).from(users)
    .where(and(eq(users.id, user.id), eq(users.accountEnabled, true)))
  const home = homeTenant()
  const tenantAllowed = active && (active.tenantId === '' || active.tenantId === home || (await allowedTenants(db, home)).has(active.tenantId))
  if (!active || !tenantAllowed) {
    await clearUserSession(event)
    throw createError({ status: 401, message: 'Compte désactivé' })
  }
  return user
}

/**
 * Exige le rôle administrateur IT (403 sinon).
 * Le rôle est lu à la connexion dans le claim `roles` : un retrait de rôle Entra prend effet au plus tard
 * à l'expiration de la session (1 h).
 */
export async function requireAdmin(event: RequestEvent) {
  const user = await requireUser(event)
  if (!user.isAdmin) throw createError({ status: 403, message: 'Accès réservé aux administrateurs IT' })
  return user
}
