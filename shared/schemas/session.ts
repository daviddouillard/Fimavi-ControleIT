import { z } from 'zod'

export const CONTROL_TEMPLATES = {
  'sharepoint-external': 'Droits SharePoint externes',
  'exchange-shared-mailboxes': 'Accès aux boîtes partagées'
} as const

export type ControlTemplate = keyof typeof CONTROL_TEMPLATES

const idList = z.array(z.uuid()).max(500).transform(ids => [...new Set(ids)])

export const createSessionSchema = z.object({
  name: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  template: z.enum(Object.keys(CONTROL_TEMPLATES) as [ControlTemplate, ...ControlTemplate[]]),
  dueDate: z.iso.datetime({ offset: true }).optional(),
  /** Modèle SharePoint : sites à analyser (au moins un). */
  siteIds: idList.optional(),
  /** Modèle boîtes partagées : tenants à analyser (au moins un). */
  connectionIds: idList.optional()
}).refine(s => s.template !== 'sharepoint-external' || (s.siteIds?.length ?? 0) > 0, {
  message: 'Sélectionnez au moins un site SharePoint',
  path: ['siteIds']
}).refine(s => s.template !== 'exchange-shared-mailboxes' || (s.connectionIds?.length ?? 0) > 0, {
  message: 'Sélectionnez au moins un tenant',
  path: ['connectionIds']
})

export type CreateSessionInput = z.infer<typeof createSessionSchema>

export const uuidParamSchema = z.uuid()
