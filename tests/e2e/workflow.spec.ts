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

  // Attendre l'hydratation : un clic avant est perdu.
  await page.waitForLoadState('networkidle')
  // Auteur du partage (journal d'audit) et N+1 suggéré affichés sur la ligne.
  await expect(page.getByText('jean.auteur@fimavi.test').first()).toBeVisible()
  await expect(page.getByText('Valérie Valideuse').first()).toBeVisible()

  for (const n of [1, 2, 3]) await rowCheckbox(page, n).click()
  await expect(page.getByText('3 ligne(s) sélectionnée(s)')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assigner au N+1 suggéré (3)' })).toBeVisible()

  await page.getByRole('button', { name: /Rechercher un valideur/ }).click()
  await page.keyboard.type('va')
  await page.getByRole('option', { name: 'Valérie Valideuse' }).click()
  await page.getByRole('button', { name: 'Assigner', exact: true }).click()
  await expect(page.getByText('3 ligne(s) assignée(s)').first()).toBeVisible()

  // Le bouton d'email reste cliquable en brouillon : la fenêtre explique pourquoi l'envoi est bloqué.
  await page.getByRole('button', { name: 'Préparer l\'email' }).click()
  const emailDialog = page.getByRole('dialog')
  await expect(emailDialog.getByText('La session est en brouillon')).toBeVisible()
  await expect(emailDialog.getByRole('button', { name: /Envoyer/ })).toBeDisabled()
  await emailDialog.getByRole('button', { name: 'Annuler' }).click()

  await rowCheckbox(page, 4).click()
  await page.getByRole('button', { name: 'Clôturer sans validation' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer' }).click()
  await expect(page.getByText('1 ligne(s) clôturée(s) sans validation').first()).toBeVisible()

  await page.getByRole('button', { name: 'Ouvrir la session' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer' }).click()
  await expect(page.getByText('Session ouverte').first()).toBeVisible()
  await expect(page.getByText('Clôturée sans validation').first()).toBeVisible()
})

test('l\'admin trie et filtre les lignes de la session', async ({ page, baseURL }) => {
  await as(page, baseURL, 'admin')
  await page.goto(sessionUrl)
  await page.waitForLoadState('networkidle')
  const firstRowNumber = () => page.locator('tbody tr').first().locator('td').nth(1)
  await expect(firstRowNumber()).toHaveText('1')

  // Tri par défaut croissant sur # : un clic inverse l'ordre, un autre colonne repart en croissant.
  await page.getByRole('button', { name: 'Trier par #' }).click()
  await expect(firstRowNumber()).not.toHaveText('1')
  await page.getByRole('button', { name: 'Trier par Ressource' }).click()
  await expect(firstRowNumber()).toHaveText('1')

  // Recherche plein texte, puis réinitialisation.
  await page.getByRole('textbox', { name: 'Rechercher dans les lignes' }).fill('projet 2')
  await expect(page.getByRole('heading', { name: /Lignes à vérifier \(1 \// })).toBeVisible()
  await expect(firstRowNumber()).toHaveText('2')
  await page.getByRole('button', { name: 'Réinitialiser les filtres' }).click()
  await expect(page.getByRole('heading', { name: /Lignes à vérifier \(\d+\)/ })).toBeVisible()
})

test('l\'admin ne peut pas envoyer les emails sans messagerie configurée', async ({ page, baseURL }) => {
  await as(page, baseURL, 'admin')
  await page.goto(sessionUrl)
  await expect(page.getByRole('heading', { name: 'Valideurs et emails' })).toBeVisible()
  await expect(page.getByText('valerie@fimavi.test').first()).toBeVisible()
  await page.getByRole('button', { name: 'Préparer l\'email' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('checkbox', { name: 'Envoyer l\'email à Valérie Valideuse' })).toBeChecked()
  await expect(dialog.getByRole('textbox').first()).toHaveValue(/partages externes à vérifier/)
  // Ajout d'un destinataire par recherche dans l'annuaire, puis retrait possible.
  await dialog.getByRole('button', { name: /Ajouter un destinataire/ }).click()
  await page.keyboard.type('ma')
  await page.getByRole('option', { name: 'Marc Manager' }).click()
  await expect(dialog.getByRole('button', { name: 'Retirer Marc Manager des destinataires' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Envoyer (2)' }).click()
  await expect(page.getByText('Messagerie non configurée').first()).toBeVisible()
})

test('le valideur répond : commentaire toujours obligatoire, trois choix possibles', async ({ page, baseURL }) => {
  await as(page, baseURL, 'validator')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'À faire (3)' })).toBeVisible()

  // La suggestion de valideur reste réservée à l'IT : elle n'est pas transmise au valideur.
  const mine = await (await page.request.get('/api/me/checks')).json() as { data: Record<string, string> }[]
  expect(mine[0]!.data.sharedBy).toBe('jean.auteur@fimavi.test')
  expect(mine.some(c => 'suggestedValidatorId' in c.data || 'suggestedValidatorName' in c.data)).toBe(false)

  await page.getByRole('button', { name: 'Répondre' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Projet 1', { exact: true })).toBeVisible()
  await expect(dialog.getByText('jean.auteur@fimavi.test')).toBeVisible()
  await dialog.getByText('Arrêter le partage').click()
  await expect(dialog.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
  await dialog.getByRole('textbox').fill('Prestataire parti en septembre')
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('heading', { name: 'À faire (2)' })).toBeVisible()

  await page.getByRole('button', { name: 'Répondre' }).first().click()
  await dialog.getByText('Valider le partage').click()
  await expect(dialog.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
  await dialog.getByRole('textbox').fill('Partenaire du projet jusqu\'en 2027')
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('heading', { name: 'Déjà répondues (2)' })).toBeVisible()

  await page.getByRole('button', { name: 'Répondre' }).first().click()
  await dialog.getByText('Mauvaise attribution').click()
  await dialog.getByRole('textbox').fill('Voir Marc Manager')
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Ligne renvoyée à l\'IT').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'À faire (0)' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Déjà répondues (2)' })).toBeVisible()
})

test('l\'admin voit la ligne à réattribuer avec le commentaire et la confie au bon valideur', async ({ page, baseURL }) => {
  await as(page, baseURL, 'admin')
  await page.goto(sessionUrl)
  await expect(page.getByText('Valérie Valideuse : « Voir Marc Manager »')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await rowCheckbox(page, 3).click()
  await page.getByRole('button', { name: /Rechercher un valideur/ }).click()
  await page.keyboard.type('Marc')
  await page.getByRole('option', { name: 'Marc Manager' }).click()
  await page.getByRole('button', { name: 'Assigner', exact: true }).click()
  await expect(page.getByText('1 ligne(s) assignée(s)').first()).toBeVisible()

  await as(page, baseURL, 'otherValidator')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'À faire (1)' })).toBeVisible()
})

test('un valideur ne peut répondre ni à une ligne qui ne lui est pas assignée ni via une autre origine', async ({ page, baseURL }) => {
  await as(page, baseURL, 'otherValidator')
  const asOther = await page.request.put(`/api/me/checks/${IDS.items[1]}/response`, { headers: { origin: baseURL! }, data: { decision: 'keep', comment: 'x' } })
  expect(asOther.status()).toBe(404)

  await as(page, baseURL, 'validator')
  const closedLine = await page.request.put(`/api/me/checks/${IDS.items[3]}/response`, { headers: { origin: baseURL! }, data: { decision: 'keep', comment: 'x' } })
  expect(closedLine.status()).toBe(404)
  const crossOrigin = await page.request.put(`/api/me/checks/${IDS.items[1]}/response`, { headers: { origin: 'https://evil.example.com' }, data: { decision: 'keep', comment: 'x' } })
  expect(crossOrigin.status()).toBe(403)
  const noComment = await page.request.put(`/api/me/checks/${IDS.items[1]}/response`, { headers: { origin: baseURL! }, data: { decision: 'keep' } })
  expect(noComment.status()).toBe(400)
  const reassignedAway = await page.request.put(`/api/me/checks/${IDS.items[2]}/response`, { headers: { origin: baseURL! }, data: { decision: 'keep', comment: 'x' } })
  expect(reassignedAway.status()).toBe(404)
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
  await expect(page.getByText('1 ligne(s) resteront sans réponse.')).toBeVisible() // ligne confiée à Marc
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer' }).click()
  await expect(page.getByText('Session clôturée').first()).toBeVisible()

  await as(page, baseURL, 'validator')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Déjà répondues (2)' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Modifier' })).toHaveCount(0)
  const late = await page.request.put(`/api/me/checks/${IDS.items[0]}/response`, { headers: { origin: baseURL! }, data: { decision: 'keep', comment: 'x' } })
  expect(late.status()).toBe(409)
})
