import { z } from 'zod'
import { GraphError, type GraphClient } from '../../utils/graph'

/**
 * Auteur des partages : recherche dans le journal d'audit Microsoft 365 (API Graph « audit log query »,
 * permission applicative AuditLogsQuery-SharePoint.Read.All, lecture seule).
 *
 * SharePoint n'expose pas le créateur d'un lien ou d'une invitation dans les permissions : seul l'audit le donne.
 * Microsoft conserve l'audit standard 180 jours : un partage plus ancien reste sans auteur connu.
 */

export const AUDIT_RETENTION_DAYS = 180

/** Événements de création d'un partage externe (liens « organisation » exclus : jamais externes). */
export const SHARING_OPERATIONS = ['AnonymousLinkCreated', 'SecureLinkCreated', 'AddedToSecureLink', 'SharingInvitationCreated', 'SharingSet'] as const

export class AuditUnavailable extends Error {}

const querySchema = z.object({ id: z.string(), status: z.string().nullish() })
const recordSchema = z.object({
  id: z.string().nullish(),
  createdDateTime: z.string().nullish(),
  operation: z.string().nullish(),
  objectId: z.string().nullish(),
  userPrincipalName: z.string().nullish(),
  userId: z.string().nullish()
}).loose()

export interface SharingEvent {
  objectUrl: string
  operation: string
  author: string
  createdAt: string
  /** Texte de l'événement (minuscules), pour retrouver l'adresse du bénéficiaire. */
  text: string
}

/** Adresse d'un fichier ou dossier, comparable entre Graph et l'audit (décodée, minuscules, sans « / » final). */
export function normalizeObjectUrl(url: string): string {
  let value = url.trim()
  try {
    value = decodeURI(value)
  } catch {
    // Adresse déjà décodée contenant un « % » : gardée telle quelle.
  }
  return value.replace(/\/+$/, '').toLowerCase()
}

function auditError(error: unknown): never {
  if (error instanceof GraphError && (error.status === 401 || error.status === 403)) {
    throw new AuditUnavailable('Journal d\'audit non accessible : permission AuditLogsQuery-SharePoint.Read.All à accorder à l\'application (auteurs des partages non renseignés)')
  }
  throw error
}

/** Lance la recherche des créations de partage des 180 derniers jours ; renvoie l'identifiant de la requête. */
export async function startSharingAuditQuery(graph: GraphClient, now = new Date()): Promise<string> {
  const start = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 24 * 3600 * 1000)
  try {
    const created = querySchema.parse(await graph.post('security/auditLog/queries', {
      displayName: `ControleIT - auteurs des partages ${now.toISOString()}`,
      filterStartDateTime: start.toISOString(),
      filterEndDateTime: now.toISOString(),
      operationFilters: [...SHARING_OPERATIONS]
    }))
    return created.id
  } catch (error) {
    auditError(error)
  }
}

/** Attend la fin de la requête d'audit (asynchrone côté Microsoft), en donnant signe de vie entre deux essais. */
export async function waitForAuditQuery(
  graph: GraphClient,
  queryId: string,
  { pollMs = 30_000, timeoutMs = 90 * 60_000, onWait = async () => {}, sleep = (ms: number) => new Promise(r => setTimeout(r, ms)) }:
  { pollMs?: number, timeoutMs?: number, onWait?: () => Promise<void>, sleep?: (ms: number) => Promise<unknown> } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let status: string | null | undefined
    try {
      status = querySchema.parse(await graph.get(`security/auditLog/queries/${encodeURIComponent(queryId)}`)).status
    } catch (error) {
      auditError(error)
    }
    if (status === 'succeeded') return
    if (status === 'failed' || status === 'cancelled') throw new Error(`Recherche dans le journal d'audit en échec (${status})`)
    if (Date.now() > deadline) throw new Error('Recherche dans le journal d\'audit trop longue : auteurs des partages non renseignés')
    await onWait()
    await sleep(pollMs)
  }
}

/** Événements de partage trouvés par la requête d'audit. */
export async function fetchSharingEvents(graph: GraphClient, queryId: string): Promise<SharingEvent[]> {
  const events: SharingEvent[] = []
  try {
    for await (const page of graph.list(`security/auditLog/queries/${encodeURIComponent(queryId)}/records`)) {
      for (const raw of page) {
        const parsed = recordSchema.safeParse(raw)
        if (!parsed.success) continue
        const r = parsed.data
        const author = r.userPrincipalName || r.userId
        if (!r.objectId || !r.operation || !author) continue
        events.push({
          objectUrl: normalizeObjectUrl(r.objectId),
          operation: r.operation,
          author: author.toLowerCase(),
          createdAt: r.createdDateTime ?? '',
          text: JSON.stringify(raw).toLowerCase()
        })
      }
    }
  } catch (error) {
    auditError(error)
  }
  return events
}

export interface AuthorMatch {
  author: string
  createdAt: string
  /** Vrai si l'événement désigne ce bénéficiaire (ou ce type de lien) ; faux si seul l'élément correspond. */
  certain: boolean
}

/**
 * Auteur le plus probable d'un partage : le plus ancien événement de création sur l'élément qui désigne le
 * bénéficiaire (son adresse, ou un lien anonyme pour « Tout le monde ») ; à défaut, le plus ancien événement
 * de partage sur l'élément, signalé comme probable.
 */
export function matchAuthor(
  line: { objectUrl: string, beneficiaryEmail: string, anonymous: boolean },
  eventsByObject: ReadonlyMap<string, SharingEvent[]>
): AuthorMatch | null {
  const events = [...(eventsByObject.get(normalizeObjectUrl(line.objectUrl)) ?? [])]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  if (!events.length) return null
  const email = line.beneficiaryEmail.toLowerCase()
  const exact = line.anonymous
    ? events.find(e => e.operation === 'AnonymousLinkCreated')
    : email ? events.find(e => e.text.includes(email)) : undefined
  const event = exact ?? events[0]!
  return { author: event.author, createdAt: event.createdAt, certain: !!exact }
}

export function indexByObject(events: SharingEvent[]): Map<string, SharingEvent[]> {
  const index = new Map<string, SharingEvent[]>()
  for (const e of events) index.set(e.objectUrl, [...(index.get(e.objectUrl) ?? []), e])
  return index
}

const managerSchema = z.object({ id: z.string(), displayName: z.string().nullish() })

/** Responsable (N+1) d'un compte dans l'annuaire Entra (User.Read.All) ; null s'il n'en a pas. */
export async function managerOf(graph: GraphClient, userPrincipalName: string): Promise<{ entraId: string, displayName: string } | null> {
  try {
    const m = managerSchema.parse(await graph.get(`users/${encodeURIComponent(userPrincipalName)}/manager?$select=id,displayName`))
    return { entraId: m.id, displayName: m.displayName ?? '' }
  } catch (error) {
    if (error instanceof GraphError && error.status === 404) return null
    throw error
  }
}
