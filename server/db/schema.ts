import { bigserial, boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const sessionStatus = pgEnum('session_status', ['draft', 'open', 'closed'])
export const checkDecision = pgEnum('check_decision', ['keep', 'remove'])
export const remediationStatus = pgEnum('remediation_status', ['todo', 'done'])

/** Collaborateurs synchronisés depuis Entra ID (Microsoft Graph). */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
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
  uniqueIndex('users_entra_id_uq').on(t.entraId),
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
  createdById: uuid('created_by_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true })
}, t => [
  index('control_sessions_status_idx').on(t.status)
])

/** Ligne à vérifier (une ligne du fichier importé), son valideur et sa réponse. */
export const checkItems = pgTable('check_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => controlSessions.id),
  rowNumber: integer('row_number').notNull(),
  /** Données brutes de la ligne importée */
  data: jsonb('data').notNull().$type<Record<string, string>>(),
  /** Résumé lisible (ressource + bénéficiaire de l'accès) */
  label: text('label').notNull(),
  assigneeId: uuid('assignee_id').references(() => users.id),
  assignedById: uuid('assigned_by_id').references(() => users.id),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),
  decision: checkDecision('decision'),
  comment: text('comment'),
  respondedById: uuid('responded_by_id').references(() => users.id),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, t => [
  index('check_items_session_idx').on(t.sessionId),
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
