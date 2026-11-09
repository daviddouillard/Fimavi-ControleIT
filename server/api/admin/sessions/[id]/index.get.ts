import { asc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { createError, defineEventHandler } from 'nuxt/server'
import { checkItems, controlSessions, remediations, users } from '../../../../db/schema'
import { latestRun } from '../../../../services/collection'
import { listAssignees, listNotifications } from '../../../../services/notifications'
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
  const responder = alias(users, 'responder')
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
    respondedByName: responder.displayName,
    closedAt: checkItems.closedAt,
    remediationStatus: remediations.status
  })
    .from(checkItems)
    .leftJoin(assignee, eq(assignee.id, checkItems.assigneeId))
    .leftJoin(responder, eq(responder.id, checkItems.respondedById))
    .leftJoin(remediations, eq(remediations.checkItemId, checkItems.id))
    .where(eq(checkItems.sessionId, session.id))
    .orderBy(asc(checkItems.rowNumber))

  const [assignees, notifications, run] = await Promise.all([
    listAssignees(db, session.id),
    listNotifications(db, session.id),
    latestRun(db, session.id)
  ])
  return { session, items, assignees, notifications, run }
})
