import { describe, expect, it } from 'vitest'
import { siteAccessMessage } from '../../server/services/graphDiagnostics'
import { GraphError, TokenError } from '../../server/utils/graph'

describe('message du test d\'un site', () => {
  it('distingue un jeton refusé, avec la cause Entra', () => {
    expect(siteAccessMessage(new TokenError(400, 'x', 'AADSTS90002'))).toContain('ID de tenant introuvable')
    expect(siteAccessMessage(new TokenError(400, 'x', 'AADSTS700016'))).toContain('consentement administrateur n\'y a pas été donné')
    expect(siteAccessMessage(new TokenError(401, 'x', 'AADSTS123'))).toBe('Jeton refusé par Microsoft (AADSTS123) : vérifiez l\'ID du tenant et le consentement administrateur')
  })

  it('distingue un site refusé ou introuvable, avec le code Graph', () => {
    expect(siteAccessMessage(new GraphError(403, 'x', 'accessDenied'))).toMatch(/^Accès au site refusé par SharePoint \(403, accessDenied\)/)
    expect(siteAccessMessage(new GraphError(404, 'x'))).toBe('Site introuvable : vérifiez l\'URL')
    expect(siteAccessMessage(new Error('réseau'))).toBe('Site injoignable')
  })
})
