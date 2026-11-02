import { and, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { createError, type RequestEvent } from 'nuxt/server'
import type { ResponseInput } from '../../shared/schemas/checks'
import { checkItems, controlSessions, remediations, users } from '../db/schema'
import { recordAudit } from '../utils/audit'
import type { Database } from '../utils/db'

export interface Actor { id: string }

/** Ligne modifiable : ni répondue, ni clôturée sans validation. */
const isPending = and(isNull(checkItems.decision), isNull(checkItems.closedAt))

/**
 * Verrou partagé sur la session : une clôture concurrente (UPDATE dans setSessionStatus) attend la fin de la
 * transaction, et inversement. Aucune modification ne peut donc passer après la clôture.
 */
async function lockSessionStatus(db: Pick<Database, 'select'>, sessionId: string) {
  const [session] = await db.select({ status: controlSessions.status }).from(controlSessions)
    .where(eq(controlSessions.id, sessionId))
    .for('share')
  return session?.status
}

async function requireSessionNotClosed(db: Pick<Database, 'select'>, sessionId: string) {
  const status = await lockSessionStatus(db, sessionId)
  if (!status) throw createError({ status: 404, message: 'Session introuvable' })
  if (status === 'closed') throw createError({ status: 409, message: 'Session clôturée' })
}

/**
 * Réponse du valideur (Oui = conserver, Non = retirer). Il peut changer d'avis tant que la session est ouverte :
 * un « Non » crée ou réactive l'action de retrait, un retour à « Oui » annule celle encore à faire.
 * Un retrait déjà effectué par l'IT n'est jamais annulé : le retour à « Oui » est alors tracé comme tel.
 */
export async function respondToCheck(db: Database, actor: Actor, itemId: string, input: ResponseInput, event?: RequestEvent) {
  return db.transaction(async (tx) => {
    // Ordre des verrous identique partout (session → ligne → remédiation) pour éviter les interblocages.
    const [ref] = await tx.select({ sessionId: checkItems.sessionId }).from(checkItems).where(eq(checkItems.id, itemId))
    const sessionStatus = ref ? await lockSessionStatus(tx, ref.sessionId) : undefined
    const [item] = await tx.select().from(checkItems).where(eq(checkItems.id, itemId)).for('update')

    // 404 plutôt que 403 : on ne révèle pas l'existence des lignes des autres valideurs.
    if (!item || item.assigneeId !== actor.id || item.closedAt) throw createError({ status: 404, message: 'Vérification introuvable' })
    if (sessionStatus !== 'open') throw createError({ status: 409, message: 'La session n\'est pas ouverte' })

    const comment = input.comment ? input.comment : null
    await tx.update(checkItems)
      .set({ decision: input.decision, comment, respondedById: actor.id, respondedAt: new Date() })
      .where(eq(checkItems.id, itemId))

    // Verrou sur la remédiation : un « Fait » concurrent de l'IT est sérialisé avec ce changement d'avis.
    const [remediation] = await tx.select().from(remediations).where(eq(remediations.checkItemId, itemId)).for('update')
    let remediationChange: 'created' | 'reopened' | 'cancelled' | 'already_removed' | null = null
    if (input.decision === 'remove') {
      if (!remediation) {
        await tx.insert(remediations).values({ checkItemId: itemId })
        remediationChange = 'created'
      } else if (remediation.status === 'cancelled') {
        await tx.update(remediations).set({ status: 'todo' }).where(and(eq(remediations.id, remediation.id), eq(remediations.status, 'cancelled')))
        remediationChange = 'reopened'
      }
    } else if (remediation?.status === 'todo') {
      await tx.update(remediations).set({ status: 'cancelled' }).where(and(eq(remediations.id, remediation.id), eq(remediations.status, 'todo')))
      remediationChange = 'cancelled'
    } else if (remediation?.status === 'done') {
      remediationChange = 'already_removed'
    }

    await recordAudit(tx, {
      actorId: actor.id,
      action: 'check.respond',
      entityType: 'check_item',
      entityId: itemId,
      sessionId: item.sessionId,
      before: { decision: item.decision, comment: item.comment, remediation: remediation?.status ?? null },
      after: { decision: input.decision, comment, remediation: remediationChange }
    }, event)

    return { decision: input.decision, comment, remediation: remediationChange }
  })
}

/** Assigne en une fois un valideur à plusieurs lignes en attente d'une session non clôturée. */
export async function assignItems(db: Database, actor: Actor, sessionId: string, input: { itemIds: string[], assigneeId: string }, event?: RequestEvent) {
  return db.transaction(async (tx) => {
    await requireSessionNotClosed(tx, sessionId)
    const [assignee] = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.id, input.assigneeId), eq(users.accountEnabled, true)))
    if (!assignee) throw createError({ status: 400, message: 'Valideur inconnu ou désactivé' })

    // Lignes éligibles verrouillées, avec leur valideur précédent pour l'audit (réassignation possible).
    const eligible = await tx.select({ id: checkItems.id, previousAssigneeId: checkItems.assigneeId }).from(checkItems)
      .where(and(eq(checkItems.sessionId, sessionId), inArray(checkItems.id, input.itemIds), isPending))
      .for('update')

    if (eligible.length) {
      await tx.update(checkItems)
        .set({ assigneeId: assignee.id, assignedById: actor.id, assignedAt: new Date() })
        .where(inArray(checkItems.id, eligible.map(e => e.id)))

      await recordAudit(tx, {
        actorId: actor.id,
        action: 'check.assign',
        entityType: 'check_item',
        sessionId,
        before: { assignees: Object.fromEntries(eligible.map(e => [e.id, e.previousAssigneeId])) },
        after: { assigneeId: assignee.id, itemIds: eligible.map(e => e.id) }
      }, event)
    }

    return { assigned: eligible.length, skipped: input.itemIds.length - eligible.length }
  })
}

/** Clôture des lignes sans validation (accès déjà connu comme légitime). */
export async function closeItemsWithoutValidation(db: Database, actor: Actor, sessionId: string, itemIds: string[], event?: RequestEvent) {
  return db.transaction(async (tx) => {
    await requireSessionNotClosed(tx, sessionId)
    const updated = await tx.update(checkItems)
      .set({ closedById: actor.id, closedAt: new Date() })
      .where(and(eq(checkItems.sessionId, sessionId), inArray(checkItems.id, itemIds), isPending))
      .returning({ id: checkItems.id, assigneeId: checkItems.assigneeId })

    if (updated.length) {
      await recordAudit(tx, {
        actorId: actor.id,
        action: 'check.close_without_validation',
        entityType: 'check_item',
        sessionId,
        before: { pending: true, assignees: Object.fromEntries(updated.map(u => [u.id, u.assigneeId])) },
        after: { itemIds: updated.map(u => u.id) }
      }, event)
    }

    return { closed: updated.length, skipped: itemIds.length - updated.length }
  })
}

const TRANSITIONS = { open: 'draft', closed: 'open' } as const

/** Ouverture (brouillon → ouverte) et clôture (ouverte → clôturée) d'une session. */
export async function setSessionStatus(db: Database, actor: Actor, sessionId: string, status: 'open' | 'closed', event?: RequestEvent) {
  return db.transaction(async (tx) => {
    const now = new Date()
    const [session] = await tx.update(controlSessions)
      .set(status === 'open' ? { status, openedAt: now } : { status, closedAt: now })
      .where(and(eq(controlSessions.id, sessionId), eq(controlSessions.status, TRANSITIONS[status])))
      .returning({ id: controlSessions.id, status: controlSessions.status })
    if (!session) throw createError({ status: 409, message: 'Changement de statut impossible depuis le statut actuel' })

    await recordAudit(tx, {
      actorId: actor.id,
      action: status === 'open' ? 'session.open' : 'session.close',
      entityType: 'control_session',
      entityId: sessionId,
      sessionId,
      before: { status: TRANSITIONS[status] },
      after: { status }
    }, event)
    return session
  })
}

/** Pot commun IT : accès à retirer (todo) ou historique des retraits effectués (done). */
export function listRemediations(db: Pick<Database, 'select'>, status: 'todo' | 'done') {
  const responder = alias(users, 'responder')
  const handler = alias(users, 'handler')
  return db.select({
    id: remediations.id,
    createdAt: remediations.createdAt,
    handledAt: remediations.handledAt,
    note: remediations.note,
    handledByName: handler.displayName,
    itemId: checkItems.id,
    label: checkItems.label,
    data: checkItems.data,
    comment: checkItems.comment,
    respondedByName: responder.displayName,
    sessionId: controlSessions.id,
    sessionName: controlSessions.name
  })
    .from(remediations)
    .innerJoin(checkItems, eq(checkItems.id, remediations.checkItemId))
    .innerJoin(controlSessions, eq(controlSessions.id, checkItems.sessionId))
    .leftJoin(responder, eq(responder.id, checkItems.respondedById))
    .leftJoin(handler, eq(handler.id, remediations.handledById))
    .where(eq(remediations.status, status))
    .orderBy(status === 'todo' ? remediations.createdAt : desc(remediations.handledAt))
    .limit(500)
}

/** L'IT a retiré l'accès : l'action quitte la liste à faire et reste dans l'historique. */
export async function markRemediationDone(db: Database, actor: Actor, remediationId: string, note: string | undefined, event?: RequestEvent) {
  return db.transaction(async (tx) => {
    const [done] = await tx.update(remediations)
      .set({ status: 'done', handledById: actor.id, handledAt: new Date(), note: note || null })
      .where(and(eq(remediations.id, remediationId), eq(remediations.status, 'todo')))
      .returning()
    if (!done) throw createError({ status: 409, message: 'Action introuvable ou déjà traitée' })

    const [item] = await tx.select({ sessionId: checkItems.sessionId }).from(checkItems).where(eq(checkItems.id, done.checkItemId))
    await recordAudit(tx, {
      actorId: actor.id,
      action: 'remediation.done',
      entityType: 'remediation',
      entityId: done.id,
      sessionId: item?.sessionId,
      before: { status: 'todo', checkItemId: done.checkItemId },
      after: { status: 'done', checkItemId: done.checkItemId, note: done.note }
    }, event)
    return done
  })
}

/** Recherche de collaborateurs actifs pour l'assignation (nom, e-mail ou UPN). */
export function searchUsers(db: Pick<Database, 'select'>, q: string) {
  const pattern = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`
  return db.select({ id: users.id, displayName: users.displayName, mail: users.mail, department: users.department })
    .from(users)
    .where(and(eq(users.accountEnabled, true), or(ilike(users.displayName, pattern), ilike(users.mail, pattern), ilike(users.userPrincipalName, pattern))))
    .orderBy(users.displayName)
    .limit(20)
}
