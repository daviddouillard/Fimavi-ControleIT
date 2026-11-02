import { asc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { createError, defineEventHandler } from 'nuxt/server'
import { checkItems, controlSessions, remediations, users } from '../../../../db/schema'
import { requireAdmin } from '../../../../utils/authz'
import { useDb } from '../../../../utils/db'
import { requireUuidParam } from '../../../../utils/params'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const sessionId = requireUuidParam(event, 'id')

  const db = useDb()
  const [session] = await db.select().from(controlSessions).where(eq(controlSessions.id, sessionId))
  if (!session) throw createError({ status: 404, message: 'Session introuvable' })

  const assignee = alias(users, 'assignee')
  const items = await db.select({
    id: checkItems.id,
    rowNumber: checkItems.rowNumber,
    label: checkItems.label,
    data: checkItems.data,
    assigneeId: checkItems.assigneeId,
    assigneeName: assignee.displayName,
    decision: checkItems.decision,
    comment: checkItems.comment,
    respondedAt: checkItems.respondedAt,
    closedAt: checkItems.closedAt,
    remediationStatus: remediations.status
  })
    .from(checkItems)
    .leftJoin(assignee, eq(assignee.id, checkItems.assigneeId))
    .leftJoin(remediations, eq(remediations.checkItemId, checkItems.id))
    .where(eq(checkItems.sessionId, session.id))
    .orderBy(asc(checkItems.rowNumber))

  return { session, items }
})
