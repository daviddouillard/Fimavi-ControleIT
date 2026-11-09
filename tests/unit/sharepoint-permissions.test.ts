import { describe, expect, it } from 'vitest'
import { emailFromLogin, externalGrants, isInternalDomain } from '../../server/controls/sharepoint-external/permissions'

const internal = new Set(['fimavi.com', 'filiale.fr'])

describe('emailFromLogin', () => {
  it('décode les noms de connexion SharePoint', () => {
    expect(emailFromLogin('i:0#.f|membership|jean.dupont_partenaire.com#ext#@fimavi.onmicrosoft.com')).toBe('jean.dupont@partenaire.com')
    expect(emailFromLogin('i:0#.f|membership|jean_dupont_partenaire.com#EXT#@fimavi.onmicrosoft.com')).toBe('jean_dupont@partenaire.com')
    expect(emailFromLogin('urn:spo:guest#Ext@Partenaire.com')).toBe('ext@partenaire.com')
    expect(emailFromLogin('i:0#.f|membership|marie@fimavi.com')).toBe('marie@fimavi.com')
    expect(emailFromLogin('c:0t.c|tenant|abc')).toBeNull()
    expect(emailFromLogin(null)).toBeNull()
  })
})

describe('isInternalDomain', () => {
  it('reconnaît les domaines du groupe et leurs sous-domaines, sans confusion de suffixe', () => {
    expect(isInternalDomain('fimavi.com', internal)).toBe(true)
    expect(isInternalDomain('mail.fimavi.com', internal)).toBe(true)
    expect(isInternalDomain('notfimavi.com', internal)).toBe(false)
    expect(isInternalDomain('fimavi.com.evil.io', internal)).toBe(false)
  })
})

describe('externalGrants', () => {
  it('remonte un lien « Tout le monde »', () => {
    const grants = externalGrants({ id: 'p1', roles: ['write'], link: { scope: 'anonymous', type: 'edit' } }, internal)
    expect(grants).toEqual([expect.objectContaining({ beneficiaryKey: 'anonymous', access: 'anonymous', role: 'write' })])
  })

  it('ignore les liens « organisation » et les accès existants', () => {
    expect(externalGrants({ id: 'p1', roles: ['read'], link: { scope: 'organization' } }, internal)).toEqual([])
    expect(externalGrants({ id: 'p1', roles: ['read'], link: { scope: 'existingAccess' } }, internal)).toEqual([])
  })

  it('ne garde que les personnes externes d\'un lien « personnes spécifiques »', () => {
    const grants = externalGrants({
      id: 'p2',
      roles: ['read'],
      link: { scope: 'users', type: 'view' },
      grantedToIdentitiesV2: [
        { user: { displayName: 'Marie', email: 'marie@fimavi.com' } },
        { user: { displayName: 'Paul', email: 'paul@filiale.fr' } },
        { siteUser: { displayName: 'Ext', loginName: 'i:0#.f|membership|ext_partner.io#ext#@fimavi.onmicrosoft.com' } }
      ]
    }, internal)
    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({ email: 'ext@partner.io', access: 'people_link', role: 'read' })
  })

  it('remonte un accès direct externe avec son expiration, et ignore « sans expiration »', () => {
    const direct = externalGrants({
      id: 'p3', roles: ['owner'], grantedToV2: { user: { displayName: 'Consultant', email: 'c@cabinet.com' } },
      expirationDateTime: '2027-01-31T00:00:00Z'
    }, internal)
    expect(direct[0]).toMatchObject({ access: 'direct', role: 'owner', expiresAt: '2027-01-31T00:00:00Z', beneficiary: 'Consultant <c@cabinet.com>' })

    const noExpiry = externalGrants({ id: 'p4', roles: ['read'], grantedToV2: { user: { email: 'c@cabinet.com' } }, expirationDateTime: '0001-01-01T00:00:00Z' }, internal)
    expect(noExpiry[0]!.expiresAt).toBeNull()
  })

  it('ignore les groupes et les comptes internes', () => {
    expect(externalGrants({ id: 'p5', roles: ['write'], grantedToV2: { siteGroup: { displayName: 'Membres' } } }, internal)).toEqual([])
    expect(externalGrants({ id: 'p6', roles: ['write'], grantedToV2: { user: { email: 'jean@fimavi.com' } } }, internal)).toEqual([])
  })

  it('traite un invité sans adresse lisible comme externe', () => {
    const grants = externalGrants({ id: 'p7', roles: ['read'], grantedToV2: { siteUser: { displayName: 'Invité', loginName: 'i:0#.f|membership|weird#ext#@fimavi.onmicrosoft.com' } } }, internal)
    expect(grants[0]).toMatchObject({ email: null, beneficiary: 'Invité' })
  })

  it('ignore une permission mal formée', () => {
    expect(externalGrants({ roles: 'x' }, internal)).toEqual([])
    expect(externalGrants(null, internal)).toEqual([])
  })
})
