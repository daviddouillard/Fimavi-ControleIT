import { createError, useRuntimeConfig } from 'nuxt/server'
import type { Mailer } from '../services/notifications'
import { graphClient } from './graph'
import { homeTenant } from './tenants'

/**
 * Envoi via Microsoft Graph depuis la boîte NUXT_MAIL_SENDER (helpdesk). La permission Mail.Send de l'application
 * est limitée à cette seule boîte côté Exchange (RBAC for Applications) : elle n'est pas accordée dans Entra.
 */
export function graphMailer(): Mailer {
  const sender = useRuntimeConfig().mailSender
  if (!sender) throw createError({ status: 503, message: 'Messagerie non configurée (NUXT_MAIL_SENDER)' })
  const graph = graphClient(homeTenant())
  return async ({ to, subject, html }) => {
    await graph.post(`users/${encodeURIComponent(sender)}/sendMail`, {
      message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to } }] },
      saveToSentItems: true
    })
  }
}

/** Adresse publique de l'application (liens dans les emails), déduite de l'URL de retour Entra. */
export function appUrl(): string {
  return new URL(useRuntimeConfig().oauth.microsoft.redirectURL).origin
}
