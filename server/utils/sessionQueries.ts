import { desc, eq, sql } from 'drizzle-orm'
import { checkItems, controlSessions, remediations } from '../db/schema'
import type { Database } from './db'

/** Toutes les sessions avec leur avancement (réponses et remédiations restantes). */
export function listSessionSummaries(db: Pick<Database, 'select'>) {
  return db.select({
    id: controlSessions.id,
    name: controlSessions.name,
    template: controlSessions.template,
    status: controlSessions.status,
    dueDate: controlSessions.dueDate,
    createdAt: controlSessions.createdAt,
    closedAt: controlSessions.closedAt,
    totalItems: sql<number>`count(distinct ${checkItems.id})::int`,
    unassigned: sql<number>`(count(distinct ${checkItems.id}) filter (where ${checkItems.assigneeId} is null and ${checkItems.decision} is null and ${checkItems.closedAt} is null))::int`,
    waiting: sql<number>`(count(distinct ${checkItems.id}) filter (where ${checkItems.assigneeId} is not null and ${checkItems.decision} is null and ${checkItems.closedAt} is null))::int`,
    answered: sql<number>`(count(distinct ${checkItems.id}) filter (where ${checkItems.decision} is not null))::int`,
    closedWithoutValidation: sql<number>`(count(distinct ${checkItems.id}) filter (where ${checkItems.closedAt} is not null))::int`,
    remediationsTodo: sql<number>`(count(distinct ${remediations.id}) filter (where ${remediations.status} = 'todo'))::int`
  })
    .from(controlSessions)
    .leftJoin(checkItems, eq(checkItems.sessionId, controlSessions.id))
    .leftJoin(remediations, eq(remediations.checkItemId, checkItems.id))
    .groupBy(controlSessions.id)
    .orderBy(desc(controlSessions.createdAt))
}
