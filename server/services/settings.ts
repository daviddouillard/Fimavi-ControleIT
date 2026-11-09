import { asc, eq } from 'drizzle-orm'
import { createError, type RequestEvent } from 'nuxt/server'
import { internalDomains, sharepointSites, tenantConnections } from '../db/schema'
import { recordAudit } from '../utils/audit'
import type { Database } from '../utils/db'
import type { Actor } from './checks'

/** Erreur 409 sur violation d'unicité (tenant ou site déjà déclaré). */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string, cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code
  return code === '23505'
}

export async function listDomains(db: Pick<Database, 'select'>): Promise<string[]> {
  const rows = await db.select({ domain: internalDomains.domain }).from(internalDomains).orderBy(asc(internalDomains.domain))
  return rows.map(r => r.domain)
}

export async function getSettings(db: Pick<Database, 'select'>) {
  const [domains, connections, sites] = await Promise.all([
    listDomains(db),
    db.select().from(tenantConnections).orderBy(asc(tenantConnections.name)),
    db.select().from(sharepointSites).orderBy(asc(sharepointSites.url))
  ])
  return { domains, connections, sites }
}

/** Remplace la liste des domaines internes (bouton « Enregistrer »). */
export async function saveDomains(db: Database, actor: Actor, domains: string[], event?: RequestEvent) {
  return db.transaction(async (tx) => {
    const before = await listDomains(tx)
    await tx.delete(internalDomains)
    if (domains.length) await tx.insert(internalDomains).values(domains.map(domain => ({ domain })))
    await recordAudit(tx, { actorId: actor.id, action: 'settings.domains', entityType: 'settings', before: { domains: before }, after: { domains } }, event)
    return domains
  })
}

export async function addConnection(db: Database, actor: Actor, input: { name: string, tenantId: string }, event?: RequestEvent) {
  return db.transaction(async (tx) => {
    try {
      const [row] = await tx.insert(tenantConnections).values(input).returning()
      await recordAudit(tx, { actorId: actor.id, action: 'settings.connection_add', entityType: 'tenant_connection', entityId: row!.id, after: row }, event)
      return row!
    } catch (error) {
      if (isUniqueViolation(error)) throw createError({ status: 409, message: 'Ce tenant est déjà raccordé' })
      throw error
    }
  })
}

export async function updateConnection(db: Database, actor: Actor, id: string, input: { name?: string, enabled?: boolean }, event?: RequestEvent) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(tenantConnections).where(eq(tenantConnections.id, id)).for('update')
    if (!before) throw createError({ status: 404, message: 'Tenant introuvable' })
    const [row] = await tx.update(tenantConnections).set(input).where(eq(tenantConnections.id, id)).returning()
    await recordAudit(tx, { actorId: actor.id, action: 'settings.connection_update', entityType: 'tenant_connection', entityId: id, before, after: row }, event)
    return row!
  })
}

export async function deleteConnection(db: Database, actor: Actor, id: string, event?: RequestEvent) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(tenantConnections).where(eq(tenantConnections.id, id)).for('update')
    if (!before) throw createError({ status: 404, message: 'Tenant introuvable' })
    const [site] = await tx.select({ id: sharepointSites.id }).from(sharepointSites).where(eq(sharepointSites.connectionId, id)).limit(1)
    if (site) throw createError({ status: 409, message: 'Retirez d\'abord les sites de ce tenant (ou désactivez-le)' })
    await tx.delete(tenantConnections).where(eq(tenantConnections.id, id))
    await recordAudit(tx, { actorId: actor.id, action: 'settings.connection_delete', entityType: 'tenant_connection', entityId: id, before }, event)
  })
}

export async function addSite(db: Database, actor: Actor, input: { connectionId: string, url: string }, event?: RequestEvent) {
  return db.transaction(async (tx) => {
    const [connection] = await tx.select({ id: tenantConnections.id }).from(tenantConnections).where(eq(tenantConnections.id, input.connectionId))
    if (!connection) throw createError({ status: 400, message: 'Tenant inconnu' })
    try {
      const [row] = await tx.insert(sharepointSites).values(input).returning()
      await recordAudit(tx, { actorId: actor.id, action: 'settings.site_add', entityType: 'sharepoint_site', entityId: row!.id, after: row }, event)
      return row!
    } catch (error) {
      if (isUniqueViolation(error)) throw createError({ status: 409, message: 'Ce site est déjà déclaré' })
      throw error
    }
  })
}

export async function updateSite(db: Database, actor: Actor, id: string, input: { enabled: boolean }, event?: RequestEvent) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(sharepointSites).where(eq(sharepointSites.id, id)).for('update')
    if (!before) throw createError({ status: 404, message: 'Site introuvable' })
    const [row] = await tx.update(sharepointSites).set(input).where(eq(sharepointSites.id, id)).returning()
    await recordAudit(tx, { actorId: actor.id, action: 'settings.site_update', entityType: 'sharepoint_site', entityId: id, before, after: row }, event)
    return row!
  })
}

export async function deleteSite(db: Database, actor: Actor, id: string, event?: RequestEvent) {
  return db.transaction(async (tx) => {
    const [before] = await tx.delete(sharepointSites).where(eq(sharepointSites.id, id)).returning()
    if (!before) throw createError({ status: 404, message: 'Site introuvable' })
    await recordAudit(tx, { actorId: actor.id, action: 'settings.site_delete', entityType: 'sharepoint_site', entityId: id, before }, event)
  })
}

/** Résultat du bouton « Tester » : nom du site lu dans SharePoint. */
export async function markSiteChecked(db: Database, id: string, displayName: string) {
  await db.update(sharepointSites).set({ displayName, lastCheckedAt: new Date() }).where(eq(sharepointSites.id, id))
}
