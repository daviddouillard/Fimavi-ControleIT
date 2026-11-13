import { createError, useRuntimeConfig } from 'nuxt/server'
import type { Mailer } from '../services/notifications'
import { graphClient, GraphError } from './graph'
import { INLINE_IMAGE_FILES } from './inlineImages'
import { homeTenant } from './tenants'

/**
 * Envoi via Microsoft Graph depuis la boîte NUXT_MAIL_SENDER (helpdesk). La permission Mail.Send de l'application
 * est limitée à cette seule boîte côté Exchange (RBAC for Applications) : elle n'est pas accordée dans Entra.
 */
export function graphMailer(): Mailer {
  const sender = useRuntimeConfig().mailSender
  if (!sender) throw createError({ status: 503, message: 'Messagerie non configurée (NUXT_MAIL_SENDER)' })
  const graph = graphClient(homeTenant())
  return async ({ to, subject, html, inlineImages = [] }) => {
    // Images intégrées (signature) : pièces jointes « inline » issues de la liste fermée du serveur.
    const attachments = inlineImages.flatMap((cid) => {
      const file = INLINE_IMAGE_FILES[cid]
      return file ? [{ '@odata.type': '#microsoft.graph.fileAttachment', 'name': file.name, 'contentType': file.contentType, 'contentBytes': file.contentBytes, 'contentId': cid, 'isInline': true }] : []
    })
    try {
      await graph.post(`users/${encodeURIComponent(sender)}/sendMail`, {
        message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to } }], ...(attachments.length ? { attachments } : {}) },
        saveToSentItems: true
      })
    } catch (error) {
      // Message lisible dans l'historique des emails (jamais de jeton ni de détail technique Graph).
      if (error instanceof GraphError && (error.status === 401 || error.status === 403)) {
        throw new Error(`Envoi refusé par Exchange (${error.status}) : l'application n'est pas autorisée à envoyer depuis ${sender} (RBAC for Applications à configurer)`)
      }
      if (error instanceof GraphError && error.status === 404) throw new Error(`Boîte d'envoi ${sender} introuvable`)
      throw error
    }
  }
}

/** Adresse publique de l'application (liens dans les emails), déduite de l'URL de retour Entra. */
export function appUrl(): string {
  return new URL(useRuntimeConfig().oauth.microsoft.redirectURL).origin
}
