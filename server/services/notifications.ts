import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { createError, type RequestEvent } from 'nuxt/server'
import { checkItems, controlSessions, notifications, users } from '../db/schema'
import { recordAudit } from '../utils/audit'
import type { Database } from '../utils/db'
import { defaultEmailDoc, defaultEmailSubject, pendingSentence } from '../../shared/emails'
import { isEmptyDoc, richToHtml, type RichNode } from '../../shared/richText'
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

export interface EmailContent {
  subject?: string
  /** Corps mis en forme (document de l'éditeur) ; absent : message par défaut. */
  message?: RichNode
  /** Signature de l'expéditeur, ajoutée en fin d'email. */
  signature?: RichNode | null
}

/**
 * Email d'un valideur : « Bonjour <nom>, », nombre de lignes en attente et lien vers l'application (toujours
 * ajoutés), puis message de l'admin et sa signature. Le HTML est produit par richToHtml (texte échappé, styles vérifiés).
 */
export function assignmentEmail(input: { recipientName: string, sessionName: string, pending: number, appUrl: string } & EmailContent): Omit<MailMessage, 'to'> {
  return {
    subject: input.subject ?? defaultEmailSubject(input.sessionName),
    html: [
      `<p>Bonjour ${escapeHtml(input.recipientName)},</p>`,
      `<p><strong>${escapeHtml(pendingSentence(input.pending, input.sessionName))}</strong><br>`
        + `<a href="${escapeHtml(input.appUrl)}">Accéder à mes vérifications</a></p>`,
      `<div>${richToHtml(input.message ?? defaultEmailDoc())}</div>`,
      ...(input.signature && !isEmptyDoc(input.signature) ? [`<br><div>${richToHtml(input.signature)}</div>`] : [])
    ].join('\n')
  }
}

/** Signature enregistrée d'un administrateur (null : aucune). */
export async function getSignature(db: Pick<Database, 'select'>, userId: string): Promise<RichNode | null> {
  const [row] = await db.select({ signature: users.emailSignature }).from(users).where(eq(users.id, userId))
  return row?.signature ?? null
}

/** Enregistre la signature d'un administrateur (document vide : signature supprimée). */
export async function saveSignature(db: Pick<Database, 'update'>, userId: string, signature: RichNode | null | undefined): Promise<RichNode | null> {
  const value = signature && !isEmptyDoc(signature) ? signature : null
  await db.update(users).set({ emailSignature: value }).where(eq(users.id, userId))
  return value
}

/**
 * Envoie un email à chaque valideur sélectionné ayant des lignes en attente (session ouverte uniquement),
 * et aux personnes de l'annuaire ajoutées à la main par l'admin (même email, sans compteur de lignes).
 * Chaque envoi, réussi ou non, est enregistré : il sert d'historique des relances.
 */
export async function sendAssignmentEmails(
  db: Database,
  actor: Actor,
  sessionId: string,
  validatorIds: string[],
  deps: { mailer: Mailer, appUrl: string, content?: EmailContent, extraRecipientIds?: string[] },
  event?: RequestEvent
) {
  const extraIds = deps.extraRecipientIds ?? []
  const recipientIds = [...new Set([...validatorIds, ...extraIds])]
  const [session] = await db.select({ name: controlSessions.name, status: controlSessions.status }).from(controlSessions).where(eq(controlSessions.id, sessionId))
  if (!session) throw createError({ status: 404, message: 'Session introuvable' })
  if (session.status !== 'open') throw createError({ status: 409, message: 'Ouvrez la session avant d\'envoyer les emails' })

  // Signature : celle saisie dans la fenêtre est enregistrée pour les prochains envois ; sinon, la signature enregistrée.
  const signature = deps.content?.signature !== undefined
    ? await saveSignature(db, actor.id, deps.content.signature)
    : await getSignature(db, actor.id)
  const content = { ...deps.content, signature }

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

  // Personnes ajoutées à la main : comptes actifs de l'annuaire, sans ligne en attente dans la session.
  const extraOnly = extraIds.filter(id => !recipients.some(r => r.id === id))
  if (extraOnly.length) {
    recipients.push(...await db.select({
      id: users.id,
      displayName: users.displayName,
      address: sql<string | null>`coalesce(${users.mail}, ${users.userPrincipalName})`,
      pending: sql<number>`0::int`
    }).from(users).where(and(inArray(users.id, extraOnly), eq(users.accountEnabled, true))))
  }

  const results: { recipientId: string, status: 'sent' | 'failed', error?: string }[] = []
  for (const recipient of recipients) {
    let status: 'sent' | 'failed' = 'sent'
    let error: string | null = null
    try {
      if (!recipient.address) throw new Error('Adresse email inconnue')
      await deps.mailer({ to: recipient.address, ...assignmentEmail({ recipientName: recipient.displayName, sessionName: session.name, pending: recipient.pending, appUrl: deps.appUrl, ...content }) })
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
    after: { results, signatureUpdated: deps.content?.signature !== undefined, addedByHand: extraOnly, skipped: recipientIds.filter(id => !recipients.some(r => r.id === id)) }
  }, event)

  return {
    sent: results.filter(r => r.status === 'sent').length,
    failed: results.filter(r => r.status === 'failed').length,
    skipped: recipientIds.length - recipients.length
  }
}
