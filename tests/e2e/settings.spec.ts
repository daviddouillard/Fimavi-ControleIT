import { expect, test } from '@playwright/test'
import { USERS } from './support/fixtures'
import { loginAs } from './support/session'

test.describe.configure({ mode: 'serial' })

test('un valideur n\'accède pas aux paramètres', async ({ page, baseURL }) => {
  await loginAs(page.context(), baseURL!, USERS.validator)
  expect((await page.request.get('/api/admin/settings')).status()).toBe(403)
  const write = await page.request.put('/api/admin/settings/domains', { headers: { origin: baseURL! }, data: { domains: ['evil.com'] } })
  expect(write.status()).toBe(403)
})

test('l\'admin enregistre les domaines internes, un tenant et un site', async ({ page, baseURL }) => {
  await loginAs(page.context(), baseURL!, USERS.admin)
  await page.goto('/admin/settings')
  await expect(page.getByRole('heading', { name: 'Paramètres' })).toBeVisible()

  const domains = page.getByRole('textbox', { name: 'Domaines internes' })
  await domains.fill('fimavi.test\npas un domaine')
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
  await domains.fill('Fimavi.test\nfiliale.test')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('2 domaine(s) enregistré(s)').first()).toBeVisible()

  await page.getByPlaceholder('Ex. Fimavi, Filiale X').fill('Fimavi')
  await page.getByPlaceholder('00000000-0000-0000-0000-000000000000').fill('11111111-1111-1111-1111-111111111111')
  await page.getByRole('button', { name: 'Ajouter le tenant' }).click()
  await expect(page.getByText('Tenant principal')).toBeVisible()

  const siteInput = page.getByRole('textbox', { name: 'Adresse du site' })
  await siteInput.fill('https://evil.example.com/sites/x')
  await page.getByRole('button', { name: 'Ajouter le site' }).click()
  await expect(page.getByText('Adresse invalide').first()).toBeVisible()

  await siteInput.fill('https://fimavi.sharepoint.com/sites/Projets/')
  await page.getByRole('button', { name: 'Ajouter le site' }).click()
  await expect(page.getByText('https://fimavi.sharepoint.com/sites/projets')).toBeVisible()

  // Après rechargement, les domaines sont bien enregistrés (normalisés).
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Domaines internes' })).toHaveValue('filiale.test\nfimavi.test')
})

test('la création de session propose les sites actifs, tous pré-cochés', async ({ page, baseURL }) => {
  await loginAs(page.context(), baseURL!, USERS.admin)
  await page.goto('/admin')
  await page.getByRole('button', { name: 'Nouvelle session' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('checkbox', { name: /fimavi\.sharepoint\.com\/sites\/projets/ })).toBeChecked()
  await dialog.getByRole('checkbox', { name: /fimavi\.sharepoint\.com\/sites\/projets/ }).click()
  await dialog.getByRole('textbox').first().fill('Revue sans site')
  await expect(dialog.getByRole('button', { name: 'Créer et rechercher les partages' })).toBeDisabled()
})
