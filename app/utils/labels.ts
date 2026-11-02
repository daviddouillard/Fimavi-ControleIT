import { CONTROL_TEMPLATES, type ControlTemplate } from '#shared/schemas/session'

export const SESSION_STATUS_LABELS = {
  draft: { label: 'Brouillon', color: 'neutral' },
  open: { label: 'Ouverte', color: 'primary' },
  closed: { label: 'Clôturée', color: 'success' }
} as const

export function templateLabel(template: string): string {
  return CONTROL_TEMPLATES[template as ControlTemplate] ?? template
}

export function formatDate(value: string | Date | null | undefined): string {
  return value ? new Date(value).toLocaleDateString('fr-FR') : '—'
}

export function formatDateTime(value: string | Date | null | undefined): string {
  return value ? new Date(value).toLocaleString('fr-FR') : '—'
}
