import { and, desc, eq, lt, type SQL } from 'drizzle-orm'
import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'
import { auditLog, users } from '../../db/schema'
import { requireAdmin } from '../../utils/authz'
import { useDb } from '../../utils/db'

const querySchema = z.object({
  sessionId: z.uuid().optional(),
  /** Pagination par curseur : id de la dernière ligne reçue */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = await getValidatedQuery(event, querySchema)

  const filters: SQL[] = []
  if (query.sessionId) filters.push(eq(auditLog.sessionId, query.sessionId))
  if (query.before) filters.push(lt(auditLog.id, query.before))

  return useDb().select({
    id: auditLog.id,
    at: auditLog.at,
    action: auditLog.action,
    entityType: auditLog.entityType,
    entityId: auditLog.entityId,
    sessionId: auditLog.sessionId,
    actorName: users.displayName,
    before: auditLog.before,
    after: auditLog.after
  })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(query.limit)
})
