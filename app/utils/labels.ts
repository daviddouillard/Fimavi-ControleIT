import { CONTROL_TEMPLATES, type ControlTemplate } from '#shared/schemas/session'

export const SESSION_STATUS_LABELS = {
  draft: { label: 'Brouillon', color: 'neutral' },
  open: { label: 'Ouverte', color: 'primary' },
  closed: { label: 'Clôturée', color: 'success' }
} as const

const AUDIT_ACTIONS: Record<string, string> = {
  'auth.login': 'Connexion',
  'directory.sync': 'Synchronisation de l\'annuaire',
  'session.create': 'Création de la session',
  'session.open': 'Ouverture de la session',
  'session.close': 'Clôture de la session',
  'check.assign': 'Assignation de lignes',
  'check.close_without_validation': 'Clôture de lignes sans validation',
  'check.respond': 'Réponse du valideur',
  'remediation.done': 'Accès retiré par l\'IT'
}

export function auditActionLabel(action: string): string {
  return AUDIT_ACTIONS[action] ?? action
}

export function templateLabel(template: string): string {
  return CONTROL_TEMPLATES[template as ControlTemplate] ?? template
}

export function formatDate(value: string | Date | null | undefined): string {
  return value ? new Date(value).toLocaleDateString('fr-FR') : '—'
}

export function formatDateTime(value: string | Date | null | undefined): string {
  return value ? new Date(value).toLocaleString('fr-FR') : '—'
}
