import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { controlModule } from '../controls'
import type { ControlModule } from '../controls/types'
import { collectionRuns, controlSessions } from '../db/schema'
import type { Database } from '../utils/db'
import { failRun, runCollection } from './collection'

/**
 * Lancement des collectes.
 *
 * En production, chaque collecte s'exécute dans une tâche Cloud Run Job (même image, variable
 * NUXT_COLLECTION_RUN_ID) : elle va au bout même si plus personne n'utilise l'application, alors qu'une
 * instance du service sans requête peut être arrêtée à tout moment. Sans Job configuré (développement,
 * tests), la collecte tourne en arrière-plan dans le processus courant.
 */

/** Nom complet d'un Job Cloud Run : projects/<projet>/locations/<région>/jobs/<job>. */
export const JOB_NAME = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z]+-[a-z]+\d+\/jobs\/[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
const RUN_API = 'https://run.googleapis.com/v2/'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** Exécute une collecte encore « en cours » dans ce processus. Renvoie false si elle n'existe pas ou n'est plus à faire. */
export async function runCollectionById(db: Database, runId: string, moduleFor: (template: string) => ControlModule = controlModule) {
  const [row] = await db.select({ status: collectionRuns.status, template: controlSessions.template })
    .from(collectionRuns)
    .innerJoin(controlSessions, eq(controlSessions.id, collectionRuns.sessionId))
    .where(eq(collectionRuns.id, runId))
  if (row?.status !== 'running') return false
  await runCollection(db, runId, moduleFor(row.template))
  return true
}

/** Jeton OAuth du compte de service de l'instance Cloud Run (serveur de métadonnées). */
async function serviceAccountToken(fetchImpl: FetchLike) {
  const res = await fetchImpl(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } })
  if (!res.ok) throw new Error(`jeton du compte de service indisponible (${res.status})`)
  return z.object({ access_token: z.string().min(1) }).parse(await res.json()).access_token
}

export interface LaunchOptions {
  /** NUXT_COLLECTION_JOB ; vide = collecte dans le processus courant. */
  job: string
  fetchImpl?: FetchLike
  moduleFor?: (template: string) => ControlModule
}

/** Lance la collecte. Ne lève jamais d'exception : un échec de lancement est consigné sur la collecte. */
export async function launchCollection(db: Database, runId: string, { job, fetchImpl = fetch, moduleFor }: LaunchOptions) {
  if (!job) {
    runCollectionById(db, runId, moduleFor).catch(error => console.error('Collecte non démarrée :', error instanceof Error ? error.message : 'erreur inconnue'))
    return
  }
  try {
    if (!JOB_NAME.test(job)) throw new Error('NUXT_COLLECTION_JOB invalide')
    const token = await serviceAccountToken(fetchImpl)
    const res = await fetchImpl(`${RUN_API}${job}:run`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides: { containerOverrides: [{ env: [{ name: 'NUXT_COLLECTION_RUN_ID', value: runId }] }] } })
    })
    if (!res.ok) throw new Error(`Cloud Run a refusé le lancement du Job (${res.status})`)
  } catch (error) {
    console.error('Collecte non démarrée :', error instanceof Error ? error.message : 'erreur inconnue')
    await failRun(db, runId, 'Lancement de la collecte impossible').catch(() => {})
  }
}
