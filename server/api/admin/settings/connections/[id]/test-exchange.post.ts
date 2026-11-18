import { and, eq, isNotNull } from 'drizzle-orm'
import { createError, defineEventHandler } from 'nuxt/server'
import { parseSharedMailboxes } from '../../../../../controls/exchange-shared-mailboxes/permissions'
import { tenantConnections, users } from '../../../../../db/schema'
import { exchangeAccessMessage } from '../../../../../services/graphDiagnostics'
import { requireAdmin } from '../../../../../utils/authz'
import { useDb } from '../../../../../utils/db'
import { exchangeClient } from '../../../../../utils/exchange'
import { requireUuidParam } from '../../../../../utils/params'

/**
 * Vérifie que l'application peut lire Exchange dans ce tenant (permission Exchange.ManageAsApp, rôle Lecteur général) :
 * nombre de boîtes partagées, puis lecture des droits de la première. Lecture seule, aucun détail de boîte renvoyé.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = requireUuidParam(event, 'id')
  const db = useDb()
  const [connection] = await db.select({ tenantId: tenantConnections.tenantId }).from(tenantConnections).where(eq(tenantConnections.id, id))
  if (!connection) throw createError({ status: 404, message: 'Tenant introuvable' })
  const [anchor] = await db.select({ upn: users.userPrincipalName }).from(users)
    .where(and(eq(users.tenantId, connection.tenantId), eq(users.accountEnabled, true), isNotNull(users.mail), isNotNull(users.userPrincipalName))).limit(1)

  try {
    const exchange = exchangeClient(connection.tenantId, anchor?.upn ?? undefined)
    const mailboxes = parseSharedMailboxes(await exchange.invoke('Get-Mailbox', { RecipientTypeDetails: 'SharedMailbox', ResultSize: 'Unlimited' }))
    const first = mailboxes[0]
    if (first) {
      await exchange.invoke('Get-MailboxPermission', { Identity: first.address }, first.address)
      await exchange.invoke('Get-RecipientPermission', { Identity: first.address }, first.address)
    }
    return { ok: true, sharedMailboxes: mailboxes.length }
  } catch (error) {
    const message = exchangeAccessMessage(error)
    console.error('Test Exchange en échec :', message)
    return { ok: false, message }
  }
})
