import { z } from 'zod'

export const CONTROL_TEMPLATES = {
  'sharepoint-external': 'Droits SharePoint externes'
} as const

export type ControlTemplate = keyof typeof CONTROL_TEMPLATES

export const createSessionSchema = z.object({
  name: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  template: z.enum(Object.keys(CONTROL_TEMPLATES) as [ControlTemplate, ...ControlTemplate[]]),
  dueDate: z.iso.datetime({ offset: true }).optional()
})

export type CreateSessionInput = z.infer<typeof createSessionSchema>

export const uuidParamSchema = z.uuid()
