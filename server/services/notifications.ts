import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { createError, type RequestEvent } from 'nuxt/server'
import { checkItems, controlSessions, notifications, users } from '../db/schema'
import { recordAudit } from '../utils/audit'
import type { Database } from '../utils/db'
import type { Actor } from './checks'

export interface MailMessage {
  to: string
  subject: string
  html: string
}

export type Mailer = (message: MailMessage) => Promise<void>

const pendingFilter = and(isNull(checkItems.decision), isNull(checkItems.closedAt))

/** Valideurs d'une session : lignes en attente et dernier email reçu. */
export async function listAssignees(db: Pick<Database, 'select'>, sessionId: string) {
  const rows = await db.select({
    id: users.id,
    displayName: users.displayName,
    mail: users.mail,
    total: sql<number>`count(${checkItems.id})::int`,
    pending: sql<number>`(count(${checkItems.id}) filter (where ${checkItems.decision} is null and ${checkItems.closedAt} is null))::int`
  })
    .from(checkItems)
    .innerJoin(users, eq(users.id, checkItems.assigneeId))
    .where(eq(checkItems.sessionId, sessionId))
    .groupBy(users.id)
    .orderBy(users.displayName)

  const sent = await db.select({ recipientId: notifications.recipientId, sentAt: notifications.sentAt, status: notifications.status })
    .from(notifications).where(eq(notifications.sessionId, sessionId)).orderBy(desc(notifications.sentAt))
  return rows.map(r => {
    const history = sent.filter(s => s.recipientId === r.id)
    return { ...r, lastSentAt: history.find(s => s.status === 'sent')?.sentAt ?? null, emailsSent: history.filter(s => s.status === 'sent').length }
  })
}

/** Historique des emails d'une session (envois et relances). */
export function listNotifications(db: Pick<Database, 'select'>, sessionId: string) {
  const recipient = alias(users, 'recipient')
  const sender = alias(users, 'sender')
  return db.select({
    id: notifications.id,
    sentAt: notifications.sentAt,
    status: notifications.status,
    pendingCount: notifications.pendingCount,
    error: notifications.error,
    recipientName: recipient.displayName,
    sentByName: sender.displayName
  })
    .from(notifications)
    .innerJoin(recipient, eq(recipient.id, notifications.recipientId))
    .innerJoin(sender, eq(sender.id, notifications.sentById))
    .where(eq(notifications.sessionId, sessionId))
    .orderBy(desc(notifications.sentAt))
    .limit(500)
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!)

export function assignmentEmail(input: { recipientName: string, sessionName: string, pending: number, appUrl: string }): Omit<MailMessage, 'to'> {
  const plural = input.pending > 1 ? 's' : ''
  return {
    subject: `ControleIT : ${input.pending} vérification${plural} à faire — ${input.sessionName}`,
    html: [
      `<p>Bonjour ${escapeHtml(input.recipientName)},</p>`,
      `<p>Le service informatique vous a confié <strong>${input.pending} vérification${plural}</strong> dans la campagne de contrôle « ${escapeHtml(input.sessionName)} ».</p>`,
      '<p>Pour chaque ligne, indiquez si le partage doit être conservé ou arrêté, ou signalez qu\'elle ne vous concerne pas, avec un commentaire.</p>',
      `<p><a href="${escapeHtml(input.appUrl)}">Accéder à mes vérifications</a></p>`,
      '<p>Merci,<br>Le service informatique</p>'
    ].join('\n')
  }
}

/**
 * Envoie un email à chaque valideur sélectionné ayant des lignes en attente (session ouverte uniquement).
 * Chaque envoi, réussi ou non, est enregistré : il sert d'historique des relances.
 */
export async function sendAssignmentEmails(
  db: Database,
  actor: Actor,
  sessionId: string,
  recipientIds: string[],
  deps: { mailer: Mailer, appUrl: string },
  event?: RequestEvent
) {
  const [session] = await db.select({ name: controlSessions.name, status: controlSessions.status }).from(controlSessions).where(eq(controlSessions.id, sessionId))
  if (!session) throw createError({ status: 404, message: 'Session introuvable' })
  if (session.status !== 'open') throw createError({ status: 409, message: 'Ouvrez la session avant d\'envoyer les emails' })

  // Seuls des valideurs ayant des lignes en attente dans cette session peuvent être destinataires.
  const recipients = await db.select({
    id: users.id,
    displayName: users.displayName,
    address: sql<string | null>`coalesce(${users.mail}, ${users.userPrincipalName})`,
    pending: sql<number>`count(${checkItems.id})::int`
  })
    .from(checkItems)
    .innerJoin(users, eq(users.id, checkItems.assigneeId))
    .where(and(eq(checkItems.sessionId, sessionId), inArray(users.id, recipientIds), eq(users.accountEnabled, true), pendingFilter))
    .groupBy(users.id)

  const results: { recipientId: string, status: 'sent' | 'failed', error?: string }[] = []
  for (const recipient of recipients) {
    let status: 'sent' | 'failed' = 'sent'
    let error: string | null = null
    try {
      if (!recipient.address) throw new Error('Adresse email inconnue')
      await deps.mailer({ to: recipient.address, ...assignmentEmail({ recipientName: recipient.displayName, sessionName: session.name, pending: recipient.pending, appUrl: deps.appUrl }) })
    } catch (e) {
      status = 'failed'
      error = e instanceof Error ? e.message : 'erreur inconnue'
    }
    await db.insert(notifications).values({ sessionId, recipientId: recipient.id, sentById: actor.id, pendingCount: recipient.pending, status, error })
    results.push({ recipientId: recipient.id, status, ...(error ? { error } : {}) })
  }

  await recordAudit(db, {
    actorId: actor.id,
    action: 'notification.send',
    entityType: 'control_session',
    entityId: sessionId,
    sessionId,
    after: { results, skipped: recipientIds.filter(id => !recipients.some(r => r.id === id)) }
  }, event)

  return {
    sent: results.filter(r => r.status === 'sent').length,
    failed: results.filter(r => r.status === 'failed').length,
    skipped: recipientIds.length - recipients.length
  }
}
