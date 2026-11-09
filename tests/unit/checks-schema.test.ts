import { describe, expect, it } from 'vitest'
import { assignSchema, responseSchema } from '../../shared/schemas/checks'

describe('responseSchema', () => {
  it.each(['keep', 'remove', 'reassign'])('exige toujours un commentaire (%s)', (decision) => {
    expect(responseSchema.safeParse({ decision }).success).toBe(false)
    expect(responseSchema.safeParse({ decision, comment: '   ' }).success).toBe(false)
    expect(responseSchema.safeParse({ decision, comment: 'Justification' }).success).toBe(true)
  })

  it('limite la longueur du commentaire', () => {
    expect(responseSchema.safeParse({ decision: 'keep', comment: 'x'.repeat(2001) }).success).toBe(false)
  })

  it('refuse une décision inconnue', () => {
    expect(responseSchema.safeParse({ decision: 'peut-être' }).success).toBe(false)
  })
})

describe('assignSchema', () => {
  const id = '6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60'

  it('dédoublonne les lignes sélectionnées', () => {
    const parsed = assignSchema.parse({ itemIds: [id, id], assigneeId: id })
    expect(parsed.itemIds).toEqual([id])
  })

  it('refuse une sélection vide ou des identifiants invalides', () => {
    expect(assignSchema.safeParse({ itemIds: [], assigneeId: id }).success).toBe(false)
    expect(assignSchema.safeParse({ itemIds: ['1 OR 1=1'], assigneeId: id }).success).toBe(false)
  })
})
