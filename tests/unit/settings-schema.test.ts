import { describe, expect, it } from 'vitest'
import { connectionCreateSchema, domainsSchema, siteUrlSchema } from '../../shared/schemas/settings'

describe('domainsSchema', () => {
  it('normalise, trie et dédoublonne', () => {
    expect(domainsSchema.parse({ domains: [' Fimavi.com ', 'filiale.fr', 'fimavi.com'] }).domains).toEqual(['filiale.fr', 'fimavi.com'])
  })

  it('refuse un domaine invalide', () => {
    for (const bad of ['fimavi', '@fimavi.com', 'http://fimavi.com', 'fi mavi.com', '-x.com']) {
      expect(domainsSchema.safeParse({ domains: [bad] }).success, bad).toBe(false)
    }
  })

  it('accepte une liste vide (enregistrement explicite)', () => {
    expect(domainsSchema.parse({ domains: [] }).domains).toEqual([])
  })
})

describe('siteUrlSchema', () => {
  it('normalise une URL de site SharePoint Online', () => {
    expect(siteUrlSchema.parse('https://Fimavi.sharepoint.com/sites/Direction/')).toBe('https://fimavi.sharepoint.com/sites/direction')
    expect(siteUrlSchema.parse('https://fimavi.sharepoint.com/teams/projet-x?web=1')).toBe('https://fimavi.sharepoint.com/teams/projet-x')
    expect(siteUrlSchema.parse('https://fimavi.sharepoint.com')).toBe('https://fimavi.sharepoint.com')
  })

  it('refuse tout ce qui n\'est pas un site SharePoint Online', () => {
    for (const bad of [
      'http://fimavi.sharepoint.com/sites/a',
      'https://evil.com/sites/a',
      'https://fimavi.sharepoint.com.evil.com/sites/a',
      'https://user:pw@fimavi.sharepoint.com/sites/a',
      'https://fimavi.sharepoint.com/sites/a/Shared%20Documents',
      'https://fimavi.sharepoint.com/personal/jean',
      'javascript:alert(1)',
      'pas une url'
    ]) {
      expect(siteUrlSchema.safeParse(bad).success, bad).toBe(false)
    }
  })
})

describe('connectionCreateSchema', () => {
  it('exige un GUID de tenant', () => {
    expect(connectionCreateSchema.safeParse({ name: 'Filiale', tenantId: '9F74A43A-08F4-4DC6-B245-547E1E000CA8' }).data?.tenantId).toBe('9f74a43a-08f4-4dc6-b245-547e1e000ca8')
    expect(connectionCreateSchema.safeParse({ name: 'Filiale', tenantId: 'common' }).success).toBe(false)
  })
})
