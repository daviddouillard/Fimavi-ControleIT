import type { ControlLine } from '../types'
import type { ExchangeObject } from '../../utils/exchange'

/**
 * Droits contrôlés sur une boîte partagée :
 * - FullAccess : lire et gérer tout le contenu (Get-MailboxPermission) ;
 * - SendAs : envoyer comme la boîte (Get-RecipientPermission) ;
 * - SendOnBehalf : envoyer « de la part de » la boîte (propriété GrantSendOnBehalfTo de Get-Mailbox).
 */
export const RIGHT_LABELS = {
  full: 'Accès total',
  sendAs: 'Envoyer en tant que',
  sendOnBehalf: 'Envoyer de la part de'
} as const
export type MailboxRight = keyof typeof RIGHT_LABELS

export interface SharedMailbox {
  address: string
  name: string
  sendOnBehalf: string[]
}

export interface MailboxGrant {
  trustee: string
  right: MailboxRight
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const texts = (value: unknown): string[] => (Array.isArray(value) ? value : [value]).map(text).filter(Boolean)
/** Booléen renvoyé tantôt en JSON, tantôt sous forme de texte (« True »). */
const yes = (value: unknown) => value === true || (typeof value === 'string' && value.toLowerCase() === 'true')

/** Comptes système d'Exchange (le propriétaire « SELF », comptes NT AUTHORITY) : jamais à valider. */
export const isSystemTrustee = (trustee: string) => !trustee || /^NT AUTHORITY\\/i.test(trustee)

/** Boîtes partagées d'une réponse Get-Mailbox (filtre redoublé côté application). */
export function parseSharedMailboxes(objects: ExchangeObject[]): SharedMailbox[] {
  return objects
    .filter(o => text(o.RecipientTypeDetails) === 'SharedMailbox')
    .map(o => ({
      address: text(o.PrimarySmtpAddress) || text(o.UserPrincipalName),
      name: text(o.DisplayName) || text(o.Name),
      sendOnBehalf: texts(o.GrantSendOnBehalfTo)
    }))
    .filter(m => m.address)
}

/** Accès total explicites (ni hérités, ni refus). */
export function fullAccessGrants(objects: ExchangeObject[]): MailboxGrant[] {
  return objects
    .filter(o => !yes(o.IsInherited) && !yes(o.Deny) && texts(o.AccessRights).some(r => r === 'FullAccess'))
    .map(o => ({ trustee: text(o.User), right: 'full' as const }))
    .filter(g => !isSystemTrustee(g.trustee))
}

/** Droits « Envoyer en tant que » explicites et autorisés. */
export function sendAsGrants(objects: ExchangeObject[]): MailboxGrant[] {
  return objects
    .filter(o => !yes(o.IsInherited) && (text(o.AccessControlType) || 'Allow') === 'Allow' && texts(o.AccessRights).some(r => r === 'SendAs'))
    .map(o => ({ trustee: text(o.Trustee), right: 'sendAs' as const }))
    .filter(g => !isSystemTrustee(g.trustee))
}

export const sendOnBehalfGrants = (mailbox: SharedMailbox): MailboxGrant[] =>
  mailbox.sendOnBehalf.map(trustee => ({ trustee, right: 'sendOnBehalf' as const })).filter(g => !isSystemTrustee(g.trustee))

/** Ligne à vérifier : une par boîte, titulaire et droit. */
export function mailboxLine(tenant: { tenantId: string, tenantName: string }, mailbox: SharedMailbox, grant: MailboxGrant, trusteeName?: string): ControlLine {
  return {
    dedupKey: [tenant.tenantId, mailbox.address, grant.trustee, grant.right].map(v => v.toLowerCase()).join('|'),
    label: `${mailbox.name || mailbox.address} — ${trusteeName ?? grant.trustee}`,
    data: {
      tenant: tenant.tenantName,
      mailbox: mailbox.address,
      mailboxName: mailbox.name,
      trustee: grant.trustee,
      ...(trusteeName ? { trusteeName } : {}),
      right: RIGHT_LABELS[grant.right],
      rightKey: grant.right
    }
  }
}
