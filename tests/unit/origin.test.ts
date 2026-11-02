import { describe, expect, it } from 'vitest'
import { isAllowedOrigin } from '../../server/utils/origin'

describe('isAllowedOrigin', () => {
  it('laisse passer les méthodes sans effet de bord', () => {
    expect(isAllowedOrigin('GET', undefined, 'app.example.com')).toBe(true)
    expect(isAllowedOrigin('HEAD', 'https://evil.example.com', 'app.example.com')).toBe(true)
  })

  it('accepte une requête de même origine', () => {
    expect(isAllowedOrigin('POST', 'https://app.example.com', 'app.example.com')).toBe(true)
    expect(isAllowedOrigin('POST', 'http://localhost:3000', 'localhost:3000')).toBe(true)
  })

  it('refuse une origine étrangère, absente ou invalide', () => {
    expect(isAllowedOrigin('POST', 'https://evil.example.com', 'app.example.com')).toBe(false)
    expect(isAllowedOrigin('DELETE', undefined, 'app.example.com')).toBe(false)
    expect(isAllowedOrigin('PATCH', 'null', 'app.example.com')).toBe(false)
  })
})
