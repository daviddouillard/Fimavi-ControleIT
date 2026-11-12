import { describe, expect, it } from 'vitest'
import { loginAllowed } from '../../server/services/access'

const internalDomains = new Set(['fimavi.com', 'a3s.fr'])

describe('accès à l\'application selon le domaine du compte', () => {
  it('accepte un compte d\'un domaine interne ou de l\'un de ses sous-domaines', () => {
    expect(loginAllowed({ isAdmin: false, addresses: ['jean@fimavi.com'], internalDomains })).toBe(true)
    expect(loginAllowed({ isAdmin: false, addresses: ['JEAN@A3S.FR'], internalDomains })).toBe(true)
    expect(loginAllowed({ isAdmin: false, addresses: ['jean@usine.a3s.fr'], internalDomains })).toBe(true)
  })

  it('accepte si l\'email ou l\'identifiant de connexion est interne', () => {
    expect(loginAllowed({ isAdmin: false, addresses: [undefined, 'jean@fimavi.com'], internalDomains })).toBe(true)
    expect(loginAllowed({ isAdmin: false, addresses: ['jean@fimavi.onmicrosoft.com', 'jean@fimavi.com'], internalDomains })).toBe(true)
  })

  it('refuse un compte hors des domaines internes, y compris un domaine ressemblant', () => {
    expect(loginAllowed({ isAdmin: false, addresses: ['x@gmail.com'], internalDomains })).toBe(false)
    expect(loginAllowed({ isAdmin: false, addresses: ['x@notfimavi.com'], internalDomains })).toBe(false)
    expect(loginAllowed({ isAdmin: false, addresses: ['x@fimavi.com.evil.io'], internalDomains })).toBe(false)
    expect(loginAllowed({ isAdmin: false, addresses: [null, undefined, 'sans-arobase'], internalDomains })).toBe(false)
  })

  it('refuse tout le monde sauf les administrateurs tant qu\'aucun domaine n\'est paramétré', () => {
    expect(loginAllowed({ isAdmin: false, addresses: ['jean@fimavi.com'], internalDomains: new Set() })).toBe(false)
    expect(loginAllowed({ isAdmin: true, addresses: ['adm@fimavi.onmicrosoft.com'], internalDomains: new Set() })).toBe(true)
  })
})
