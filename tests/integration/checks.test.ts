import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLog, checkItems, remediations } from '../../server/db/schema'
import {
  assignItems, closeItemsWithoutValidation, listRemediations, markRemediationDone,
  respondToCheck, searchUsers, setSessionStatus
} from '../../server/services/checks'
import type { Database } from '../../server/utils/db'
import { createTestDb, seedSession } from './helpers'

let db: Database
let close: () => Promise<void>

beforeAll(async () => {
  ({ db, close } = await createTestDb())
})
afterAll(() => close())

const remediationOf = async (itemId: string) =>
  (await db.select().from(remediations).where(eq(remediations.checkItemId, itemId)))[0]

describe('assignItems', () => {
  it('assigne uniquement les lignes en attente de la session', async () => {
    const s = await seedSession(db)
    const other = await seedSession(db)
    await db.update(checkItems).set({ decision: 'keep' }).where(eq(checkItems.id, s.items[1]!.id))
    await db.update(checkItems).set({ closedAt: new Date() }).where(eq(checkItems.id, s.items[2]!.id))

    const result = await assignItems(db, s.admin, s.session.id, {
      assigneeId: s.validator.id,
      itemIds: [s.items[0]!.id, s.items[1]!.id, s.items[2]!.id, other.items[0]!.id]
    })
    expect(result).toEqual({ assigned: 1, skipped: 3 })

    const [foreign] = await db.select().from(checkItems).where(eq(checkItems.id, other.items[0]!.id))
    expect(foreign!.assigneeId).toBeNull()
  })

  it('refuse un valideur désactivé et une session clôturée', async () => {
    const s = await seedSession(db)
    await expect(assignItems(db, s.admin, s.session.id, { assigneeId: s.disabled.id, itemIds: [s.items[0]!.id] }))
      .rejects.toMatchObject({ status: 400 })

    const closed = await seedSession(db, 'closed')
    await expect(assignItems(db, closed.admin, closed.session.id, { assigneeId: closed.validator.id, itemIds: [closed.items[0]!.id] }))
      .rejects.toMatchObject({ status: 409 })
  })
})

describe('respondToCheck', () => {
  it('gère le changement d\'avis : Non → Oui → Non', async () => {
    const s = await seedSession(db)
    const item = s.items[0]!
    await assignItems(db, s.admin, s.session.id, { assigneeId: s.validator.id, itemIds: [item.id] })

    expect((await respondToCheck(db, s.validator, item.id, { decision: 'remove', comment: 'Prestataire parti' })).remediation).toBe('created')
    expect((await remediationOf(item.id))!.status).toBe('todo')

    expect((await respondToCheck(db, s.validator, item.id, { decision: 'keep' })).remediation).toBe('cancelled')
    expect((await remediationOf(item.id))!.status).toBe('cancelled')

    expect((await respondToCheck(db, s.validator, item.id, { decision: 'remove', comment: 'Finalement non' })).remediation).toBe('reopened')
    expect((await remediationOf(item.id))!.status).toBe('todo')

    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, item.id))
    expect(audits.filter(a => a.action === 'check.respond')).toHaveLength(3)
  })

  it('ne rouvre pas un retrait déjà effectué', async () => {
    const s = await seedSession(db)
    const item = s.items[0]!
    await assignItems(db, s.admin, s.session.id, { assigneeId: s.validator.id, itemIds: [item.id] })
    await respondToCheck(db, s.validator, item.id, { decision: 'remove', comment: 'À retirer' })
    await markRemediationDone(db, s.admin, (await remediationOf(item.id))!.id, 'Retiré dans SharePoint')

    const result = await respondToCheck(db, s.validator, item.id, { decision: 'keep' })
    expect(result.remediation).toBe('already_removed')
    expect((await remediationOf(item.id))!.status).toBe('done')
  })

  it('sérialise un « Fait » de l\'IT et un changement d\'avis simultanés sans perdre le retrait', async () => {
    const s = await seedSession(db)
    const item = s.items[0]!
    await assignItems(db, s.admin, s.session.id, { assigneeId: s.validator.id, itemIds: [item.id] })
    await respondToCheck(db, s.validator, item.id, { decision: 'remove', comment: 'À retirer' })
    const remediation = (await remediationOf(item.id))!

    await Promise.allSettled([
      markRemediationDone(db, s.admin, remediation.id, undefined),
      respondToCheck(db, s.validator, item.id, { decision: 'keep' })
    ])
    const final = (await remediationOf(item.id))!.status
    const done = (await listRemediations(db, 'done')).some(r => r.id === remediation.id)
    // Soit l'IT est passée avant (retrait conservé dans l'historique), soit l'annulation (rien à faire) : jamais un retrait perdu.
    expect(final === 'done' ? done : final === 'cancelled').toBe(true)
  })

  it('refuse un autre utilisateur (404), une session non ouverte (409) et une ligne clôturée (404)', async () => {
    const s = await seedSession(db)
    await assignItems(db, s.admin, s.session.id, { assigneeId: s.validator.id, itemIds: [s.items[0]!.id, s.items[1]!.id] })

    await expect(respondToCheck(db, s.other, s.items[0]!.id, { decision: 'keep' })).rejects.toMatchObject({ status: 404 })
    await expect(respondToCheck(db, s.validator, s.items[3]!.id, { decision: 'keep' })).rejects.toMatchObject({ status: 404 })
    await expect(respondToCheck(db, s.validator, crypto.randomUUID(), { decision: 'keep' })).rejects.toMatchObject({ status: 404 })

    await closeItemsWithoutValidation(db, s.admin, s.session.id, [s.items[1]!.id])
    await expect(respondToCheck(db, s.validator, s.items[1]!.id, { decision: 'keep' })).rejects.toMatchObject({ status: 404 })

    const draft = await seedSession(db, 'draft')
    await assignItems(db, draft.admin, draft.session.id, { assigneeId: draft.validator.id, itemIds: [draft.items[0]!.id] })
    await expect(respondToCheck(db, draft.validator, draft.items[0]!.id, { decision: 'keep' })).rejects.toMatchObject({ status: 409 })
  })
})

describe('closeItemsWithoutValidation', () => {
  it('clôture les lignes en attente et ignore celles déjà répondues', async () => {
    const s = await seedSession(db)
    await db.update(checkItems).set({ decision: 'remove' }).where(eq(checkItems.id, s.items[0]!.id))
    const result = await closeItemsWithoutValidation(db, s.admin, s.session.id, [s.items[0]!.id, s.items[1]!.id])
    expect(result).toEqual({ closed: 1, skipped: 1 })
  })

  it('ne journalise rien quand aucune ligne n\'est modifiée', async () => {
    const s = await seedSession(db)
    const count = async () => (await db.select().from(auditLog).where(eq(auditLog.sessionId, s.session.id))).length
    const before = await count()
    await closeItemsWithoutValidation(db, s.admin, s.session.id, [crypto.randomUUID()])
    await assignItems(db, s.admin, s.session.id, { assigneeId: s.validator.id, itemIds: [crypto.randomUUID()] })
    expect(await count()).toBe(before)
  })
})

describe('setSessionStatus', () => {
  it('suit brouillon → ouverte → clôturée, sans retour arrière', async () => {
    const s = await seedSession(db, 'draft')
    await expect(setSessionStatus(db, s.admin, s.session.id, 'closed')).rejects.toMatchObject({ status: 409 })
    await setSessionStatus(db, s.admin, s.session.id, 'open')
    await expect(setSessionStatus(db, s.admin, s.session.id, 'open')).rejects.toMatchObject({ status: 409 })
    await setSessionStatus(db, s.admin, s.session.id, 'closed')
    await expect(setSessionStatus(db, s.admin, s.session.id, 'open')).rejects.toMatchObject({ status: 409 })
  })
})

describe('remédiations', () => {
  it('une action faite quitte la liste à faire, passe dans l\'historique et ne se traite qu\'une fois', async () => {
    const s = await seedSession(db)
    const item = s.items[0]!
    await assignItems(db, s.admin, s.session.id, { assigneeId: s.validator.id, itemIds: [item.id] })
    await respondToCheck(db, s.validator, item.id, { decision: 'remove', comment: 'Inconnu' })
    const remediation = (await remediationOf(item.id))!

    expect((await listRemediations(db, 'todo')).map(r => r.id)).toContain(remediation.id)
    await markRemediationDone(db, s.admin, remediation.id, undefined)
    expect((await listRemediations(db, 'todo')).map(r => r.id)).not.toContain(remediation.id)
    const done = (await listRemediations(db, 'done')).find(r => r.id === remediation.id)
    expect(done).toMatchObject({ handledByName: 'Admin IT', comment: 'Inconnu', respondedByName: 'Valideur N+1' })

    await expect(markRemediationDone(db, s.admin, remediation.id, undefined)).rejects.toMatchObject({ status: 409 })
  })
})

describe('searchUsers', () => {
  it('trouve les comptes actifs et neutralise les jokers LIKE', async () => {
    await seedSession(db)
    const found = await searchUsers(db, 'valideur')
    expect(found.length).toBeGreaterThan(0)
    expect(found.every(u => u.displayName.includes('Valideur'))).toBe(true)
    expect(await searchUsers(db, 'désactivé')).toEqual([])
    expect(await searchUsers(db, '%%')).toEqual([])
  })
})
