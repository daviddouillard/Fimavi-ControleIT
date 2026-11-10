import { z } from 'zod'

/**
 * Lecture des permissions Graph d'un élément SharePoint (driveItem) et extraction des partages externes.
 * Externe = lien « Tout le monde » (anonyme), ou personne qui n'est pas membre du tenant (invité #ext#,
 * invité SharePoint) et dont l'adresse n'est pas dans un domaine interne du groupe. Un compte membre du tenant
 * (nom de connexion « membership » ou identifiant présent dans l'annuaire synchronisé) n'est jamais externe. Les groupes SharePoint et les liens « organisation » sont ignorés.
 */

const identitySchema = z.object({
  id: z.string().optional(),
  displayName: z.string().nullish(),
  email: z.string().nullish(),
  loginName: z.string().nullish()
}).optional()

const identitySetSchema = z.object({
  user: identitySchema,
  siteUser: identitySchema,
  group: identitySchema,
  siteGroup: identitySchema
}).optional()

export const permissionSchema = z.object({
  id: z.string(),
  roles: z.array(z.string()).default([]),
  link: z.object({ scope: z.string().nullish(), type: z.string().nullish() }).nullish(),
  grantedToV2: identitySetSchema.nullable(),
  grantedToIdentitiesV2: z.array(identitySetSchema).nullish(),
  invitation: z.object({ email: z.string().nullish() }).nullish(),
  expirationDateTime: z.string().nullish()
})

export type GraphPermission = z.infer<typeof permissionSchema>

export type ShareAccess = 'anonymous' | 'people_link' | 'direct'
export type ShareRole = 'read' | 'write' | 'owner'

export interface ExternalGrant {
  /** Clé stable du bénéficiaire : adresse e-mail en minuscules, « anonymous » ou identifiant de connexion. */
  beneficiaryKey: string
  beneficiary: string
  email: string | null
  access: ShareAccess
  role: ShareRole
  expiresAt: string | null
}

export const ACCESS_LABELS: Record<ShareAccess, string> = {
  anonymous: 'Lien « Tout le monde »',
  people_link: 'Lien personnes spécifiques',
  direct: 'Accès direct'
}

export const ROLE_LABELS: Record<ShareRole, string> = {
  read: 'Lecture',
  write: 'Modification',
  owner: 'Contrôle total'
}

export function roleOf(roles: string[]): ShareRole {
  if (roles.includes('owner')) return 'owner'
  if (roles.includes('write')) return 'write'
  return 'read'
}

const EMAIL = /^[^\s@|#]+@[^\s@|#]+\.[^\s@|#]+$/

/**
 * Adresse e-mail déduite d'un nom de connexion SharePoint :
 * - invité Entra : i:0#.f|membership|jean_partenaire.com#ext#@tenant.onmicrosoft.com → jean@partenaire.com
 * - invité SharePoint : urn:spo:guest#jean@partenaire.com
 * - compte du tenant : i:0#.f|membership|jean@fimavi.com
 */
export function emailFromLogin(login: string | null | undefined): string | null {
  if (!login) return null
  const last = login.slice(login.lastIndexOf('|') + 1)
  const ext = last.toLowerCase().indexOf('#ext#')
  if (ext > 0) {
    const local = last.slice(0, ext)
    const at = local.lastIndexOf('_')
    const email = at > 0 ? `${local.slice(0, at)}@${local.slice(at + 1)}` : ''
    return EMAIL.test(email) ? email.toLowerCase() : null
  }
  const guest = login.match(/^urn:spo:guest#(.+)$/i)?.[1] ?? last
  return EMAIL.test(guest) ? guest.toLowerCase() : null
}

export function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase()
}

/** Domaine interne : égal à un domaine de la liste ou sous-domaine de celui-ci. */
export function isInternalDomain(domain: string, internal: ReadonlySet<string>): boolean {
  for (const d of internal) {
    if (domain === d || domain.endsWith(`.${d}`)) return true
  }
  return false
}

/** Nom de connexion d'un compte membre du tenant (pas un invité Entra #ext#, pas un invité SharePoint urn:spo:guest). */
export function isTenantMemberLogin(login: string | null | undefined): boolean {
  const value = login?.toLowerCase() ?? ''
  return value.startsWith('i:0#.f|membership|') && !value.includes('#ext#')
}

type IdentitySet = z.infer<typeof identitySetSchema>

/** Personne désignée par une identité (les groupes sont ignorés) et son caractère externe. */
function externalPerson(identity: IdentitySet | null, invitationEmail: string | null | undefined, internal: ReadonlySet<string>, members: ReadonlySet<string>) {
  const person = identity?.user ?? identity?.siteUser
  if (!person && !invitationEmail) return null
  // Membre du tenant présent dans l'annuaire synchronisé (identifiant Entra) : jamais externe.
  const userId = identity?.user?.id?.toLowerCase()
  if (userId && members.has(userId)) return null
  const login = identity?.siteUser?.loginName ?? identity?.user?.loginName
  // Compte membre du tenant (i:0#.f|membership|…, sans #ext#) : jamais externe, quel que soit son domaine
  // (comptes d'administration en …onmicrosoft.com, domaine absent de la liste…).
  if (isTenantMemberLogin(login)) return null
  const rawEmail = person?.email ?? identity?.siteUser?.email ?? null
  const email = (rawEmail && EMAIL.test(rawEmail) ? rawEmail.toLowerCase() : null) ?? emailFromLogin(login) ?? (invitationEmail && EMAIL.test(invitationEmail) ? invitationEmail.toLowerCase() : null)

  if (email) {
    if (isInternalDomain(domainOf(email), internal)) return null
    return { beneficiaryKey: email, beneficiary: person?.displayName ? `${person.displayName} <${email}>` : email, email }
  }
  // Adresse inconnue : seul un compte invité (#ext#) est considéré comme externe.
  if (login && login.toLowerCase().includes('#ext#')) {
    return { beneficiaryKey: `login:${login.toLowerCase()}`, beneficiary: person?.displayName ?? login, email: null }
  }
  return null
}

function expiry(value: string | null | undefined): string | null {
  // 0001-01-01 signifie « sans expiration » côté Graph.
  return value && !value.startsWith('0001-') ? value : null
}

/**
 * @param internal domaines internes du groupe
 * @param members identifiants Entra (minuscules) des membres du tenant du site, issus de l'annuaire synchronisé
 */
export function externalGrants(raw: unknown, internal: ReadonlySet<string>, members: ReadonlySet<string> = new Set()): ExternalGrant[] {
  const parsed = permissionSchema.safeParse(raw)
  if (!parsed.success) return []
  const p = parsed.data
  const role = roleOf(p.roles)
  const expiresAt = expiry(p.expirationDateTime)

  if (p.link) {
    const scope = p.link.scope ?? ''
    if (scope === 'anonymous') {
      return [{ beneficiaryKey: 'anonymous', beneficiary: 'Tout le monde (lien anonyme)', email: null, access: 'anonymous', role, expiresAt }]
    }
    if (scope !== 'users') return []
    const identities = [...(p.grantedToIdentitiesV2 ?? []), ...(p.grantedToV2 ? [p.grantedToV2] : [])]
    const grants = new Map<string, ExternalGrant>()
    for (const identity of identities) {
      const person = externalPerson(identity, null, internal, members)
      if (person) grants.set(person.beneficiaryKey, { ...person, access: 'people_link', role, expiresAt })
    }
    return [...grants.values()]
  }

  const person = externalPerson(p.grantedToV2, p.invitation?.email, internal, members)
  return person ? [{ ...person, access: 'direct', role, expiresAt }] : []
}
