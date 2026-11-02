import { and, eq } from 'drizzle-orm'
import { createError, type RequestEvent } from 'nuxt/server'
import { users } from '../db/schema'
import { useDb } from './db'

/**
 * Exige un utilisateur connecté (401 sinon).
 * Le compte est revérifié en base à chaque requête : un compte désactivé à la synchro Entra perd l'accès immédiatement.
 */
export async function requireUser(event: RequestEvent) {
  const { user } = await requireUserSession(event, { status: 401, message: 'Authentification requise' })
  const [active] = await useDb().select({ id: users.id }).from(users)
    .where(and(eq(users.id, user.id), eq(users.accountEnabled, true)))
  if (!active) {
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
