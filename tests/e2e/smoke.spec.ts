import { expect, test } from '@playwright/test'

test('un visiteur non connecté est redirigé vers la page de connexion', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByTestId('login-microsoft')).toBeVisible()
})

test("les pages d'administration redirigent aussi vers la connexion", async ({ page }) => {
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/login$/)
})

test('la connexion redirige vers Entra ID avec le bon tenant', async ({ request }) => {
  const res = await request.get('/auth/microsoft', { maxRedirects: 0 })
  expect(res.status()).toBe(302)
  const location = new URL(res.headers().location!)
  expect(location.host).toBe('login.microsoftonline.com')
  expect(location.pathname).toContain('11111111-1111-1111-1111-111111111111')
  expect(location.searchParams.get('scope')).toContain('openid')
  expect(location.searchParams.get('state')).toBeTruthy()
  expect(location.searchParams.get('nonce')).toBeTruthy()
  expect(location.searchParams.get('code_challenge')).toBeTruthy()
  expect(location.searchParams.get('code_challenge_method')).toBe('S256')
  expect(res.headers()['set-cookie']).toMatch(/controleit-oidc=.*HttpOnly/i)
})

test('un retour de connexion forgé (sans state mémorisé) est refusé', async ({ request }) => {
  const res = await request.get('/auth/microsoft?code=volé&state=inventé', { maxRedirects: 0 })
  expect(res.status()).toBe(302)
  expect(res.headers().location).toBe('/login?error=1')
})

test("la page de connexion se charge sans violation CSP ni erreur JS", async ({ page }) => {
  const errors: string[] = []
  page.on('console', msg => msg.type() === 'error' && errors.push(msg.text()))
  page.on('pageerror', err => errors.push(err.message))
  await page.goto('/login')
  await expect(page.getByTestId('login-microsoft')).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(errors).toEqual([])
})

test.describe('API protégées', () => {
  for (const path of ['/api/me/checks', '/api/admin/sessions', '/api/admin/audit']) {
    test(`GET ${path} sans session → 401`, async ({ request }) => {
      const res = await request.get(path)
      expect(res.status()).toBe(401)
    })
  }

  test('POST depuis une origine étrangère → 403', async ({ request }) => {
    const res = await request.post('/api/admin/sessions', {
      headers: { origin: 'https://evil.example.com' },
      data: { name: 'Test', template: 'sharepoint-external' }
    })
    expect(res.status()).toBe(403)
  })

  test('POST de même origine sans session → 401', async ({ request, baseURL }) => {
    const res = await request.post('/api/admin/sessions', {
      headers: { origin: baseURL! },
      data: { name: 'Test', template: 'sharepoint-external' }
    })
    expect(res.status()).toBe(401)
  })
})

test('les en-têtes de sécurité sont présents', async ({ request }) => {
  const res = await request.get('/login')
  const headers = res.headers()
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(headers['content-security-policy']).toContain("default-src 'self'")
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-powered-by']).toBeUndefined()
})
