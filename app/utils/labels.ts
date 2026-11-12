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
  'remediation.done': 'Accès retiré par l\'IT',
  'collection.start': 'Lancement de la collecte',
  'collection.finish': 'Fin de la collecte',
  'notification.send': 'Envoi des emails aux valideurs',
  'settings.domains': 'Domaines internes modifiés',
  'settings.connection_add': 'Tenant raccordé',
  'settings.connection_update': 'Tenant modifié',
  'settings.connection_delete': 'Tenant retiré',
  'settings.site_add': 'Site SharePoint ajouté',
  'settings.site_update': 'Site SharePoint modifié',
  'settings.site_delete': 'Site SharePoint retiré'
}

/** Réponses du valideur. */
export const DECISION_LABELS = {
  keep: 'Partage validé',
  remove: 'Partage à arrêter',
  reassign: 'Mauvaise attribution'
} as const

/** Champs d'une ligne collectée, dans l'ordre d'affichage (les champs absents ne sont pas affichés). */
const ITEM_FIELDS: [key: string, label: string][] = [
  ['tenant', 'Tenant'],
  ['site', 'Site'],
  ['resourceType', 'Type'],
  ['resource', 'Ressource'],
  ['beneficiary', 'Bénéficiaire'],
  ['access', 'Type de partage'],
  ['role', 'Droit'],
  ['expiresAt', 'Expiration'],
  ['sharedBy', 'Partagé par']
]

export function itemFields(data: Record<string, string>): { label: string, value: string }[] {
  return ITEM_FIELDS.filter(([key]) => data[key]).map(([key, label]) => ({
    label,
    value: key === 'expiresAt' ? formatDateTime(data[key]) : data[key]!
  }))
}

/** Lien vers la ressource, uniquement s'il pointe vers SharePoint Online (données collectées, jamais de v-html). */
export function sharepointLink(data: Record<string, string>): string | null {
  try {
    const url = new URL(data.resourceUrl ?? '')
    return url.protocol === 'https:' && url.hostname.endsWith('.sharepoint.com') ? url.toString() : null
  } catch {
    return null
  }
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
