import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import { defineEventHandler } from 'nuxt/server'
import { checkItems, controlSessions } from '../../db/schema'
import { requireUser } from '../../utils/authz'
import { useDb } from '../../utils/db'

/**
 * Vérifications assignées à l'utilisateur connecté : sessions ouvertes ou clôturées, jamais les brouillons,
 * ni les lignes clôturées sans validation par l'admin.
 */
/** Champs réservés à l'IT (suggestion de valideur, adresse technique), retirés avant envoi au valideur. */
const ADMIN_ONLY_FIELDS = ['suggestedValidatorId', 'suggestedValidatorName', 'objectUrl']

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  const rows = await useDb().select({
    id: checkItems.id,
    label: checkItems.label,
    data: checkItems.data,
    decision: checkItems.decision,
    comment: checkItems.comment,
    respondedAt: checkItems.respondedAt,
    sessionId: controlSessions.id,
    sessionName: controlSessions.name,
    sessionStatus: controlSessions.status,
    dueDate: controlSessions.dueDate
  })
    .from(checkItems)
    .innerJoin(controlSessions, eq(controlSessions.id, checkItems.sessionId))
    .where(and(eq(checkItems.assigneeId, user.id), ne(controlSessions.status, 'draft'), isNull(checkItems.closedAt)))
    .orderBy(asc(controlSessions.createdAt), asc(checkItems.rowNumber))
  return rows.map(row => ({
    ...row,
    data: Object.fromEntries(Object.entries(row.data).filter(([key]) => !ADMIN_ONLY_FIELDS.includes(key)))
  }))
})
