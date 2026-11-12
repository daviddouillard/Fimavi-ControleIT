import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import { createError, type RequestEvent } from 'nuxt/server'
import { CollectionStopped, type ControlLine, type ControlModule } from '../controls/types'
import { checkItems, collectionRuns, controlSessions } from '../db/schema'
import { recordAudit } from '../utils/audit'
import type { Database } from '../utils/db'
import type { Actor } from './checks'
import { listDomains } from './settings'

/** Une collecte sans signe de vie depuis ce délai est considérée comme interrompue (instance arrêtée…). */
export const STALE_AFTER_MS = 10 * 60 * 1000
/** Fréquence du signe de vie d'une collecte en cours (bien inférieure au délai d'interruption). */
export const HEARTBEAT_MS = 60 * 1000

export interface CollectionReport {
  added: number
  duplicates: number
  errors: { source: string, message: string }[]
  [key: string]: unknown
}

/** Marque en échec les collectes interrompues de la session, pour permettre une relance. */
async function failStaleRuns(db: Pick<Database, 'update'>, sessionId: string) {
  await db.update(collectionRuns)
    .set({ status: 'failed', finishedAt: new Date(), error: 'Collecte interrompue' })
    .where(and(eq(collectionRuns.sessionId, sessionId), eq(collectionRuns.status, 'running'), lt(collectionRuns.heartbeatAt, new Date(Date.now() - STALE_AFTER_MS))))
}

/** Marque en échec une collecte encore en cours (lancement impossible…). */
export async function failRun(db: Pick<Database, 'update'>, runId: string, error: string) {
  await db.update(collectionRuns)
    .set({ status: 'failed', finishedAt: new Date(), error })
    .where(and(eq(collectionRuns.id, runId), eq(collectionRuns.status, 'running')))
}

/** Dernière collecte d'une session (affichage de l'avancement). */
export async function latestRun(db: Database, sessionId: string) {
  await failStaleRuns(db, sessionId)
  const [run] = await db.select().from(collectionRuns).where(eq(collectionRuns.sessionId, sessionId))
    .orderBy(desc(collectionRuns.startedAt)).limit(1)
  return run ?? null
}

/**
 * Démarre une collecte sur une session en brouillon. Une seule collecte en cours par session
 * (index unique partiel) ; une relance n'ajoute que les lignes absentes (clé de dédoublonnage).
 */
export async function startCollection(db: Database, actor: Actor, sessionId: string, event?: RequestEvent) {
  return db.transaction(async (tx) => {
    const [session] = await tx.select({ status: controlSessions.status }).from(controlSessions)
      .where(eq(controlSessions.id, sessionId)).for('update')
    if (!session) throw createError({ status: 404, message: 'Session introuvable' })
    if (session.status !== 'draft') throw createError({ status: 409, message: 'La collecte n\'est possible que sur une session en brouillon' })
    if (!(await listDomains(tx)).length) throw createError({ status: 400, message: 'Renseignez d\'abord les domaines internes dans les paramètres' })

    await failStaleRuns(tx, sessionId)
    const [running] = await tx.select({ id: collectionRuns.id }).from(collectionRuns)
      .where(and(eq(collectionRuns.sessionId, sessionId), eq(collectionRuns.status, 'running')))
    if (running) throw createError({ status: 409, message: 'Une collecte est déjà en cours' })

    const [run] = await tx.insert(collectionRuns).values({ sessionId, startedById: actor.id }).returning()
    await recordAudit(tx, { actorId: actor.id, action: 'collection.start', entityType: 'collection_run', entityId: run!.id, sessionId }, event)
    return run!
  })
}

/** Exécute la collecte (en arrière-plan) et consigne le résultat. Ne lève jamais d'exception. */
export async function runCollection(db: Database, runId: string, module: ControlModule, { heartbeatMs = HEARTBEAT_MS } = {}) {
  const [run] = await db.select().from(collectionRuns).where(eq(collectionRuns.id, runId))
  if (!run) return
  const [session] = await db.select().from(controlSessions).where(eq(controlSessions.id, run.sessionId))
  if (!session) return

  const report: CollectionReport = { added: 0, duplicates: 0, errors: [] }
  // Collecte déclarée interrompue ou terminée ailleurs : on arrête au prochain point de contrôle.
  let stopped = false
  const save = async (extra: Partial<typeof collectionRuns.$inferInsert> = {}) => {
    const rows = await db.update(collectionRuns).set({ heartbeatAt: new Date(), progress: { ...report }, ...extra })
      .where(and(eq(collectionRuns.id, runId), eq(collectionRuns.status, 'running')))
      .returning({ id: collectionRuns.id })
    if (!rows.length) stopped = true
  }
  const checkpoint = () => {
    if (stopped) throw new CollectionStopped('Collecte arrêtée : exécution interrompue')
  }

  async function addLines(lines: ControlLine[]) {
    checkpoint()
    if (!lines.length) return
    for (let i = 0; i < lines.length; i += 500) {
      const batch = lines.slice(i, i + 500)
      // Doublons écartés avant numérotation (une seule collecte en cours par session : pas de concurrence ici).
      const existing = new Set((await db.select({ key: checkItems.dedupKey }).from(checkItems)
        .where(and(eq(checkItems.sessionId, session!.id), inArray(checkItems.dedupKey, batch.map(l => l.dedupKey)))))
        .map(r => r.key))
      const fresh = [...new Map(batch.filter(l => !existing.has(l.dedupKey)).map(l => [l.dedupKey, l])).values()]
      report.duplicates += batch.length - fresh.length
      if (!fresh.length) continue

      const inserted = await db.transaction(async (tx) => {
        // Session verrouillée (même ordre que les autres écritures) : aucune ligne n'est ajoutée après l'ouverture,
        // ni par une collecte déclarée interrompue entre-temps.
        const [current] = await tx.select({ status: controlSessions.status }).from(controlSessions)
          .where(eq(controlSessions.id, session!.id)).for('share')
        const [self] = await tx.select({ status: collectionRuns.status }).from(collectionRuns)
          .where(eq(collectionRuns.id, runId)).for('update')
        if (current?.status !== 'draft') throw new CollectionStopped('Collecte arrêtée : la session n\'est plus en brouillon')
        if (self?.status !== 'running') throw new CollectionStopped('Collecte arrêtée : exécution interrompue')

        const [max] = await tx.select({ value: sql<number>`coalesce(max(${checkItems.rowNumber}), 0)::int` }).from(checkItems)
          .where(eq(checkItems.sessionId, session!.id))
        let rowNumber = max?.value ?? 0
        return tx.insert(checkItems)
          .values(fresh.map(line => ({ sessionId: session!.id, rowNumber: ++rowNumber, dedupKey: line.dedupKey, label: line.label, data: line.data })))
          .onConflictDoNothing({ target: [checkItems.sessionId, checkItems.dedupKey] })
          .returning({ id: checkItems.id })
      })
      report.added += inserted.length
      report.duplicates += fresh.length - inserted.length
    }
    await save()
    checkpoint()
  }

  async function annotateLines(patches: { dedupKey: string, data: Record<string, string> }[]) {
    checkpoint()
    for (let i = 0; i < patches.length; i += 200) {
      const batch = patches.slice(i, i + 200)
      await db.transaction(async (tx) => {
        // Mêmes verrous et conditions que l'ajout : rien n'est modifié hors brouillon ni par une collecte interrompue.
        const [current] = await tx.select({ status: controlSessions.status }).from(controlSessions)
          .where(eq(controlSessions.id, session!.id)).for('share')
        const [self] = await tx.select({ status: collectionRuns.status }).from(collectionRuns)
          .where(eq(collectionRuns.id, runId)).for('update')
        if (current?.status !== 'draft') throw new CollectionStopped('Collecte arrêtée : la session n\'est plus en brouillon')
        if (self?.status !== 'running') throw new CollectionStopped('Collecte arrêtée : exécution interrompue')
        for (const patch of batch) {
          await tx.update(checkItems)
            .set({ data: sql`${checkItems.data} || ${JSON.stringify(patch.data)}::jsonb` })
            .where(and(eq(checkItems.sessionId, session!.id), eq(checkItems.dedupKey, patch.dedupKey)))
        }
      })
    }
    await save()
    checkpoint()
  }

  // Signe de vie régulier, même pendant une longue étape sans avancement visible (permissions, attente Graph).
  const heartbeat = setInterval(() => {
    save().catch(error => console.error('Collecte : signe de vie non enregistré :', error instanceof Error ? error.message : 'erreur inconnue'))
  }, heartbeatMs)

  try {
    await module.collect({
      db,
      config: session.config,
      internalDomains: new Set(await listDomains(db)),
      addLines,
      annotateLines,
      progress: async (state) => {
        Object.assign(report, state)
        await save()
        checkpoint()
      },
      siteError: async (source, message) => {
        report.errors.push({ source, message })
        await save()
      }
    })
    await save({ status: 'succeeded', finishedAt: new Date() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'erreur inconnue'
    console.error('Collecte en échec :', message)
    await save({ status: 'failed', finishedAt: new Date(), error: message }).catch(() => {})
  } finally {
    clearInterval(heartbeat)
  }

  await recordAudit(db, {
    actorId: run.startedById,
    action: 'collection.finish',
    entityType: 'collection_run',
    entityId: runId,
    sessionId: session.id,
    after: { added: report.added, duplicates: report.duplicates, errors: report.errors }
  }).catch(() => {})
}
