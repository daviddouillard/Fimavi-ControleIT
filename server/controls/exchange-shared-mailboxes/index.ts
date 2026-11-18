import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import { tenantConnections, users } from '../../db/schema'
import type { Database } from '../../utils/db'
import type { ExchangeClient } from '../../utils/exchange'
import { CollectionStopped, type CollectionContext, type ControlLine, type ControlModule } from '../types'
import { fullAccessGrants, mailboxLine, parseSharedMailboxes, sendAsGrants, sendOnBehalfGrants } from './permissions'

export const sharedMailboxConfigSchema = z.object({ connectionIds: z.array(z.uuid()).min(1).max(50) })

export interface SharedMailboxDeps {
  /** Client Exchange d'un tenant ; `anchor` : une boîte existante du tenant pour l'aiguillage. */
  exchangeFor: (tenantId: string, anchor?: string) => ExchangeClient
}

/** Tenants retenus pour la session, encore raccordés et actifs. */
export async function sessionTenants(db: Pick<Database, 'select'>, connectionIds: string[]) {
  return db.select({ tenantId: tenantConnections.tenantId, tenantName: tenantConnections.name })
    .from(tenantConnections)
    .where(and(inArray(tenantConnections.id, connectionIds), eq(tenantConnections.enabled, true)))
}

/** Annuaire synchronisé d'un tenant : nom affiché par adresse (email ou identifiant) et une boîte d'aiguillage. */
async function tenantDirectory(db: Pick<Database, 'select'>, tenantId: string) {
  const rows = await db.select({ displayName: users.displayName, mail: users.mail, upn: users.userPrincipalName })
    .from(users).where(and(eq(users.tenantId, tenantId), eq(users.accountEnabled, true), isNotNull(users.mail)))
  const names = new Map<string, string>()
  for (const r of rows) {
    for (const address of [r.mail, r.upn]) if (address) names.set(address.toLowerCase(), r.displayName)
  }
  return { names, anchor: rows.find(r => r.upn)?.upn ?? rows[0]?.mail ?? undefined }
}

/** Accès aux boîtes aux lettres partagées : accès total, envoyer en tant que, envoyer de la part de. */
export function sharedMailboxModule(deps: SharedMailboxDeps): ControlModule {
  return {
    async collect(ctx: CollectionContext) {
      const { connectionIds } = sharedMailboxConfigSchema.parse(ctx.config)
      const tenants = await sessionTenants(ctx.db, connectionIds)
      if (!tenants.length) throw new Error('Aucun tenant actif à analyser')

      for (const [index, tenant] of tenants.entries()) {
        try {
          const directory = await tenantDirectory(ctx.db, tenant.tenantId)
          const exchange = deps.exchangeFor(tenant.tenantId, directory.anchor)
          await ctx.progress({ site: tenant.tenantName, sitesDone: index, sitesTotal: tenants.length })
          const mailboxes = parseSharedMailboxes(await exchange.invoke('Get-Mailbox', { RecipientTypeDetails: 'SharedMailbox', ResultSize: 'Unlimited' }))

          for (const [done, mailbox] of mailboxes.entries()) {
            try {
              const [full, sendAs] = await Promise.all([
                exchange.invoke('Get-MailboxPermission', { Identity: mailbox.address }, mailbox.address),
                exchange.invoke('Get-RecipientPermission', { Identity: mailbox.address }, mailbox.address)
              ])
              const grants = [...fullAccessGrants(full), ...sendAsGrants(sendAs), ...sendOnBehalfGrants(mailbox)]
              const lines: ControlLine[] = grants.map(g => mailboxLine(tenant, mailbox, g, directory.names.get(g.trustee.toLowerCase())))
              await ctx.addLines(lines)
            } catch (error) {
              if (error instanceof CollectionStopped) throw error
              await ctx.siteError(`${tenant.tenantName} : ${mailbox.address}`, error instanceof Error ? error.message : 'erreur inconnue')
            }
            await ctx.progress({ site: tenant.tenantName, sitesDone: index, sitesTotal: tenants.length, mailboxesDone: done + 1, mailboxesTotal: mailboxes.length })
          }
        } catch (error) {
          if (error instanceof CollectionStopped) throw error
          // Un tenant inaccessible (permission, rôle) n'arrête pas les autres : l'erreur est remontée dans le compte rendu.
          await ctx.siteError(tenant.tenantName, error instanceof Error ? error.message : 'erreur inconnue')
        }
      }
      await ctx.progress({ sitesDone: tenants.length, sitesTotal: tenants.length })
    }
  }
}
