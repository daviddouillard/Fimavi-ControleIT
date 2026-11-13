import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { notifySchema } from '../../../../../shared/schemas/checks'
import { sendAssignmentEmails } from '../../../../services/notifications'
import { requireAdmin } from '../../../../utils/authz'
import { useDb } from '../../../../utils/db'
import { appUrl, graphMailer } from '../../../../utils/mailer'
import { requireUuidParam } from '../../../../utils/params'

/** Envoie (ou renvoie, en relance) l'email « vous avez des vérifications à faire » aux valideurs sélectionnés. */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const sessionId = requireUuidParam(event, 'id')
  const { recipientIds, extraRecipientIds, subject, message, signature } = await readValidatedBody(event, notifySchema)
  return sendAssignmentEmails(useDb(), admin, sessionId, recipientIds, {
    mailer: graphMailer(), appUrl: appUrl(), content: { subject, message, signature }, extraRecipientIds
  }, event)
})
