import { sql } from 'drizzle-orm'
import { defineEventHandler, getQuery, sendRedirect, useRuntimeConfig } from 'nuxt/server'
import { users } from '../../db/schema'
import { recordAudit } from '../../utils/audit'
import { useDb } from '../../utils/db'
import { buildAuthorizationUrl, handleCallback } from '../../utils/entraOidc'
import { hasRole } from '../../utils/idToken'

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as { code?: string, state?: string, error?: string }

  if (!query.code && !query.error) return sendRedirect(event, buildAuthorizationUrl(event))

  try {
    if (query.error) throw new Error(`Entra a refusé la connexion (${query.error})`)
    const claims = await handleCallback(event, query)

    const isAdmin = hasRole(claims, useRuntimeConfig().adminRole)
    const email = claims.email ?? claims.preferred_username ?? null
    const name = claims.name ?? email ?? claims.oid

    const user = await useDb().transaction(async (tx) => {
      const [row] = await tx.insert(users)
        .values({ entraId: claims.oid, displayName: name, mail: email })
        .onConflictDoUpdate({ target: users.entraId, set: { displayName: name, mail: sql`coalesce(${users.mail}, excluded.mail)` } })
        .returning({ id: users.id, accountEnabled: users.accountEnabled })
      if (!row!.accountEnabled) throw new Error('Compte désactivé')
      await recordAudit(tx, { actorId: row!.id, action: 'auth.login', entityType: 'user', entityId: row!.id, after: { isAdmin } }, event)
      return row!
    })

    // replace (et non set) : aucune donnée d'une session précédente n'est conservée.
    await replaceUserSession(event, {
      user: { id: user.id, entraId: claims.oid, name, email, isAdmin },
      loggedInAt: new Date().toISOString()
    })
    return sendRedirect(event, isAdmin ? '/admin' : '/')
  } catch (error) {
    console.error('Échec de connexion Microsoft :', error instanceof Error ? error.message : 'erreur inconnue')
    return sendRedirect(event, '/login?error=1')
  }
})
