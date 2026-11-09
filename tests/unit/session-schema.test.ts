import { describe, expect, it } from 'vitest'
import { createSessionSchema } from '../../shared/schemas/session'

const siteId = '6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60'

describe('createSessionSchema', () => {
  it('accepte une session valide et dédoublonne les sites', () => {
    const parsed = createSessionSchema.parse({ name: '  Revue T4  ', template: 'sharepoint-external', siteIds: [siteId, siteId] })
    expect(parsed.name).toBe('Revue T4')
    expect(parsed.siteIds).toEqual([siteId])
  })

  it('exige au moins un site pour le modèle SharePoint', () => {
    expect(createSessionSchema.safeParse({ name: 'Revue', template: 'sharepoint-external' }).success).toBe(false)
    expect(createSessionSchema.safeParse({ name: 'Revue', template: 'sharepoint-external', siteIds: [] }).success).toBe(false)
    expect(createSessionSchema.safeParse({ name: 'Revue', template: 'sharepoint-external', siteIds: ['x'] }).success).toBe(false)
  })

  it('refuse un modèle inconnu ou un nom trop court', () => {
    expect(createSessionSchema.safeParse({ name: 'Revue', template: 'inconnu' }).success).toBe(false)
    expect(createSessionSchema.safeParse({ name: 'ab', template: 'sharepoint-external' }).success).toBe(false)
  })

  it('ignore les champs non prévus (pas de mass assignment)', () => {
    const parsed = createSessionSchema.parse({ name: 'Revue', template: 'sharepoint-external', siteIds: [siteId], status: 'closed', createdById: 'x', config: {} })
    expect(parsed).not.toHaveProperty('status')
    expect(parsed).not.toHaveProperty('createdById')
    expect(parsed).not.toHaveProperty('config')
  })
})
