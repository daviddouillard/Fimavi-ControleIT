import { getRequestIP, type RequestEvent } from 'nuxt/server'
import { auditLog } from '../db/schema'
import type { Database, Transaction } from './db'

export interface AuditEntry {
  actorId: string | null
  action: string
  entityType: string
  entityId?: string | null
  sessionId?: string | null
  before?: unknown
  after?: unknown
}

/**
 * Enregistre une action dans le journal d'audit.
 * À appeler dans la même transaction que la modification pour garantir la cohérence.
 */
export async function recordAudit(db: Database | Transaction, entry: AuditEntry, event?: RequestEvent) {
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    sessionId: entry.sessionId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: event ? getRequestIP(event) ?? null : null
  })
}
