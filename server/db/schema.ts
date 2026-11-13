import { sql } from 'drizzle-orm'
import { bigserial, boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const sessionStatus = pgEnum('session_status', ['draft', 'open', 'closed'])
/** keep : partage validé ; remove : à arrêter ; reassign : mauvaise attribution, la ligne revient à l'admin. */
export const checkDecision = pgEnum('check_decision', ['keep', 'remove', 'reassign'])
export const collectionStatus = pgEnum('collection_status', ['running', 'succeeded', 'failed'])
export const notificationStatus = pgEnum('notification_status', ['sent', 'failed'])
/** cancelled : le valideur est revenu sur un « Non » avant que l'IT ait retiré l'accès. */
export const remediationStatus = pgEnum('remediation_status', ['todo', 'done', 'cancelled'])

/** Collaborateurs synchronisés depuis Entra ID (Microsoft Graph). */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Tenant Entra du compte (claim tid). Vide pour les comptes créés avant le multi-tenant, rattachés au tenant principal. */
  tenantId: text('tenant_id').notNull(),
  entraId: text('entra_id').notNull(),
  displayName: text('display_name').notNull(),
  mail: text('mail'),
  userPrincipalName: text('user_principal_name'),
  jobTitle: text('job_title'),
  department: text('department'),
  accountEnabled: boolean('account_enabled').notNull().default(true),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  uniqueIndex('users_tenant_entra_id_uq').on(t.tenantId, t.entraId),
  index('users_display_name_idx').on(t.displayName)
])

/** Session de contrôle : instance d'un modèle (ex. droits SharePoint externes). */
export const controlSessions = pgTable('control_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  template: text('template').notNull(),
  status: sessionStatus('status').notNull().default('draft'),
  dueDate: timestamp('due_date', { withTimezone: true }),
  /** Paramètres propres au modèle de contrôle (ex. sites SharePoint retenus). */
  config: jsonb('config').notNull().default({}).$type<Record<string, unknown>>(),
  createdById: uuid('created_by_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true })
}, t => [
  index('control_sessions_status_idx').on(t.status)
])

/** Ligne à vérifier (un partage collecté), son valideur et sa réponse. */
export const checkItems = pgTable('check_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => controlSessions.id),
  rowNumber: integer('row_number').notNull(),
  /** Détail de la ligne collectée (champs affichés) */
  data: jsonb('data').notNull().$type<Record<string, string>>(),
  /** Résumé lisible (ressource + bénéficiaire de l'accès) */
  label: text('label').notNull(),
  /** Clé de dédoublonnage (ressource + bénéficiaire + droit) : une seule ligne par clé et par session. */
  dedupKey: text('dedup_key'),
  assigneeId: uuid('assignee_id').references(() => users.id),
  assignedById: uuid('assigned_by_id').references(() => users.id),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),
  decision: checkDecision('decision'),
  comment: text('comment'),
  respondedById: uuid('responded_by_id').references(() => users.id),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  /** Ligne clôturée par l'admin sans validation (accès déjà connu comme légitime). */
  closedById: uuid('closed_by_id').references(() => users.id),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  index('check_items_session_idx').on(t.sessionId),
  uniqueIndex('check_items_session_dedup_uq').on(t.sessionId, t.dedupKey),
  uniqueIndex('check_items_session_row_uq').on(t.sessionId, t.rowNumber),
  index('check_items_assignee_idx').on(t.assigneeId)
])

/** Action IT générée par une réponse « Non » (accès à retirer). */
export const remediations = pgTable('remediations', {
  id: uuid('id').primaryKey().defaultRandom(),
  checkItemId: uuid('check_item_id').notNull().references(() => checkItems.id),
  status: remediationStatus('status').notNull().default('todo'),
  note: text('note'),
  handledById: uuid('handled_by_id').references(() => users.id),
  handledAt: timestamp('handled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  uniqueIndex('remediations_check_item_uq').on(t.checkItemId),
  index('remediations_status_idx').on(t.status)
])

/** Journal d'audit en ajout seul : UPDATE et DELETE sont bloqués par un trigger (migration 0001). */
export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  actorId: uuid('actor_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  sessionId: uuid('session_id').references(() => controlSessions.id),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: text('ip')
}, t => [
  index('audit_log_session_idx').on(t.sessionId),
  index('audit_log_at_idx').on(t.at)
])

/** Tenants Entra raccordés (groupe Fimavi) : connexion de leurs collaborateurs, annuaire et sites SharePoint. */
export const tenantConnections = pgTable('tenant_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  uniqueIndex('tenant_connections_tenant_uq').on(t.tenantId)
])

/** Sites SharePoint à contrôler, ajoutés manuellement dans les paramètres. */
export const sharepointSites = pgTable('sharepoint_sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  connectionId: uuid('connection_id').notNull().references(() => tenantConnections.id),
  url: text('url').notNull(),
  displayName: text('display_name'),
  enabled: boolean('enabled').notNull().default(true),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  uniqueIndex('sharepoint_sites_url_uq').on(t.url)
])

/** Domaines de messagerie du groupe : toute adresse hors de cette liste est externe. */
export const internalDomains = pgTable('internal_domains', {
  domain: text('domain').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

/** Exécutions de la collecte des lignes d'une session (une seule en cours à la fois). */
export const collectionRuns = pgTable('collection_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => controlSessions.id),
  status: collectionStatus('status').notNull().default('running'),
  startedById: uuid('started_by_id').notNull().references(() => users.id),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  progress: jsonb('progress').notNull().default({}).$type<Record<string, unknown>>(),
  error: text('error')
}, t => [
  index('collection_runs_session_idx').on(t.sessionId),
  uniqueIndex('collection_runs_one_running_uq').on(t.sessionId).where(sql`${t.status} = 'running'`)
])

/** Emails envoyés aux valideurs (envoi initial et relances). */
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => controlSessions.id),
  recipientId: uuid('recipient_id').notNull().references(() => users.id),
  sentById: uuid('sent_by_id').notNull().references(() => users.id),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  pendingCount: integer('pending_count').notNull(),
  status: notificationStatus('status').notNull(),
  error: text('error')
}, t => [
  index('notifications_session_idx').on(t.sessionId)
])
