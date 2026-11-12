import { sql } from 'drizzle-orm'
import { defineEventHandler, getQuery, sendRedirect, useRuntimeConfig } from 'nuxt/server'
import { users } from '../../db/schema'
import { recordAudit } from '../../utils/audit'
import { useDb } from '../../utils/db'
import { buildAuthorizationUrl, handleCallback } from '../../utils/entraOidc'
import { hasRole } from '../../utils/idToken'
import { claimLegacyUsers, homeTenant } from '../../utils/tenants'
import { DomainNotAllowed, loginAllowed } from '../../services/access'
import { listDomains } from '../../services/settings'

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as { code?: string, state?: string, error?: string, admin_consent?: string }

  // Retour du lien de consentement administrateur d'un tenant filiale (paramètres) : rien à vérifier ici,
  // le paramètre tenant de la réponse n'est jamais utilisé pour authentifier.
  if (query.admin_consent && !query.error) return sendRedirect(event, '/login?consent=1')

  try {
    if (!query.code && !query.error) return sendRedirect(event, await buildAuthorizationUrl(event))
    if (query.error) throw new Error(`Entra a refusé la connexion (${query.error})`)
    const claims = await handleCallback(event, query)

    const home = homeTenant()
    const tenantId = claims.tid.toLowerCase()
    // Les administrateurs IT sont uniquement des comptes du tenant principal.
    const isAdmin = tenantId === home && hasRole(claims, useRuntimeConfig().adminRole)
    const email = claims.email ?? claims.preferred_username ?? null
    const name = claims.name ?? email ?? claims.oid

    // Seuls les comptes des domaines internes du groupe (et les administrateurs IT) accèdent à l'application.
    const internalDomains = new Set(await listDomains(useDb()))
    if (!loginAllowed({ isAdmin, addresses: [claims.email, claims.preferred_username], internalDomains })) throw new DomainNotAllowed()

    const user = await useDb().transaction(async (tx) => {
      if (tenantId === home) await claimLegacyUsers(tx, home)
      const [row] = await tx.insert(users)
        .values({ tenantId, entraId: claims.oid, displayName: name, mail: email })
        .onConflictDoUpdate({ target: [users.tenantId, users.entraId], set: { displayName: name, mail: sql`coalesce(${users.mail}, excluded.mail)` } })
        .returning({ id: users.id, accountEnabled: users.accountEnabled })
      if (!row!.accountEnabled) throw new Error('Compte désactivé')
      await recordAudit(tx, { actorId: row!.id, action: 'auth.login', entityType: 'user', entityId: row!.id, after: { isAdmin, tenantId } }, event)
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
    return sendRedirect(event, error instanceof DomainNotAllowed ? '/login?error=domain' : '/login?error=1')
  }
})
