import { domainOf, isInternalDomain } from '../controls/sharepoint-external/permissions'

/** Refus de connexion : compte hors des domaines internes du groupe. */
export class DomainNotAllowed extends Error {
  constructor() {
    super('Domaine du compte non autorisé')
  }
}

/**
 * Accès à l'application : tout compte dont l'adresse (email ou identifiant de connexion) appartient à un domaine
 * interne du groupe (Paramètres), ou un administrateur IT (qui doit pouvoir configurer ces domaines).
 */
export function loginAllowed(input: { isAdmin: boolean, addresses: (string | null | undefined)[], internalDomains: ReadonlySet<string> }): boolean {
  if (input.isAdmin) return true
  return input.addresses.some(address => !!address && address.includes('@') && isInternalDomain(domainOf(address), input.internalDomains))
}
