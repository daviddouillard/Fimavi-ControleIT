import { describe, expect, it } from 'vitest'
import { createSessionSchema } from '../../shared/schemas/session'

describe('createSessionSchema', () => {
  it('accepte une session valide', () => {
    const parsed = createSessionSchema.parse({ name: '  Revue T4  ', template: 'sharepoint-external' })
    expect(parsed.name).toBe('Revue T4')
  })

  it('refuse un modèle inconnu ou un nom trop court', () => {
    expect(createSessionSchema.safeParse({ name: 'Revue', template: 'inconnu' }).success).toBe(false)
    expect(createSessionSchema.safeParse({ name: 'ab', template: 'sharepoint-external' }).success).toBe(false)
  })

  it('ignore les champs non prévus (pas de mass assignment)', () => {
    const parsed = createSessionSchema.parse({ name: 'Revue', template: 'sharepoint-external', status: 'closed', createdById: 'x' })
    expect(parsed).not.toHaveProperty('status')
    expect(parsed).not.toHaveProperty('createdById')
  })
})
