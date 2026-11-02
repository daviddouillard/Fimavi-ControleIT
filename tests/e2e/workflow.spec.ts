import { expect, test, type Page } from '@playwright/test'
import { IDS, USERS } from './support/fixtures'
import { loginAs } from './support/session'

// Parcours complet d'une session, joué dans l'ordre sur la même base.
test.describe.configure({ mode: 'serial' })

const sessionUrl = `/admin/sessions/${IDS.session}`

async function as(page: Page, baseURL: string | undefined, user: keyof typeof USERS) {
  await loginAs(page.context(), baseURL!, USERS[user])
}

const rowCheckbox = (page: Page, rowNumber: number) =>
  page.getByRole('row').filter({ has: page.getByRole('cell', { name: String(rowNumber), exact: true }) })
    .getByRole('checkbox', { name: 'Sélectionner la ligne' })

test('un valideur ne voit rien tant que la session est en brouillon et n\'accède pas à l\'administration', async ({ page, baseURL }) => {
  await as(page, baseURL, 'validator')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'À faire (0)' })).toBeVisible()

  await page.goto('/admin')
  await expect(page).toHaveURL(/\/$/)
  expect((await page.request.get('/api/admin/sessions')).status()).toBe(403)
})

test('l\'admin assigne plusieurs lignes, en clôture une sans validation et ouvre la session', async ({ page, baseURL }) => {
  await as(page, baseURL, 'admin')
  await page.goto(sessionUrl)
  await expect(page.getByRole('heading', { name: 'Revue E2E accès externes' })).toBeVisible()

  for (const n of [1, 2, 3]) await rowCheckbox(page, n).click()
  await expect(page.getByText('3 ligne(s) sélectionnée(s)')).toBeVisible()

  await page.getByRole('button', { name: /Rechercher un valideur/ }).click()
  await page.keyboard.type('Valérie')
  await page.getByRole('option', { name: 'Valérie Valideuse' }).click()
  await page.getByRole('button', { name: 'Assigner' }).click()
  await expect(page.getByText('3 ligne(s) assignée(s)').first()).toBeVisible()

  await rowCheckbox(page, 4).click()
  await page.getByRole('button', { name: 'Clôturer sans validation' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer' }).click()
  await expect(page.getByText('1 ligne(s) clôturée(s) sans validation').first()).toBeVisible()

  await page.getByRole('button', { name: 'Ouvrir la session' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer' }).click()
  await expect(page.getByText('Session ouverte').first()).toBeVisible()
  await expect(page.getByText('Clôturée sans validation').first()).toBeVisible()
})

test('le valideur répond : commentaire obligatoire pour Non, facultatif pour Oui', async ({ page, baseURL }) => {
  await as(page, baseURL, 'validator')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'À faire (3)' })).toBeVisible()

  await page.getByRole('button', { name: 'Répondre' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('Non, retirer l\'accès').click()
  await expect(dialog.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
  await dialog.getByRole('textbox').fill('Prestataire parti en septembre')
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('heading', { name: 'À faire (2)' })).toBeVisible()

  await page.getByRole('button', { name: 'Répondre' }).first().click()
  await dialog.getByText('Oui, conserver l\'accès').click()
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('heading', { name: 'Déjà répondues (2)' })).toBeVisible()
})

test('un valideur ne peut répondre ni à une ligne qui ne lui est pas assignée ni via une autre origine', async ({ page, baseURL }) => {
  await as(page, baseURL, 'otherValidator')
  const asOther = await page.request.put(`/api/me/checks/${IDS.items[2]}/response`, { headers: { origin: baseURL! }, data: { decision: 'keep' } })
  expect(asOther.status()).toBe(404)

  await as(page, baseURL, 'validator')
  const closedLine = await page.request.put(`/api/me/checks/${IDS.items[3]}/response`, { headers: { origin: baseURL! }, data: { decision: 'keep' } })
  expect(closedLine.status()).toBe(404)
  const crossOrigin = await page.request.put(`/api/me/checks/${IDS.items[2]}/response`, { headers: { origin: 'https://evil.example.com' }, data: { decision: 'keep' } })
  expect(crossOrigin.status()).toBe(403)
  const noComment = await page.request.put(`/api/me/checks/${IDS.items[2]}/response`, { headers: { origin: baseURL! }, data: { decision: 'remove' } })
  expect(noComment.status()).toBe(400)
})

test('l\'IT traite le retrait : il quitte la liste et apparaît dans l\'historique', async ({ page, baseURL }) => {
  await as(page, baseURL, 'admin')
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Accès à retirer (1)' })).toBeVisible()
  await expect(page.getByText('Prestataire parti en septembre')).toBeVisible()
  await page.getByRole('button', { name: 'Fait' }).click()
  await expect(page.getByText('Rien à retirer pour le moment.')).toBeVisible()

  await page.goto('/admin/history')
  await expect(page.getByRole('heading', { name: 'Accès retirés (1)' })).toBeVisible()
  await expect(page.getByText('par Admin IT')).toBeVisible()
})

test('après clôture de la session, le valideur ne peut plus modifier ses réponses', async ({ page, baseURL }) => {
  await as(page, baseURL, 'admin')
  await page.goto(sessionUrl)
  await page.getByRole('button', { name: 'Clôturer la session' }).click()
  await expect(page.getByText('1 ligne(s) resteront sans réponse.')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer' }).click()
  await expect(page.getByText('Session clôturée').first()).toBeVisible()

  await as(page, baseURL, 'validator')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Déjà répondues (2)' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Modifier' })).toHaveCount(0)
  const late = await page.request.put(`/api/me/checks/${IDS.items[0]}/response`, { headers: { origin: baseURL! }, data: { decision: 'keep' } })
  expect(late.status()).toBe(409)
})
