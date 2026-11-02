import { z } from 'zod'

/** Liste d'identifiants de lignes, dédoublonnée. */
export const itemIdsSchema = z.array(z.uuid()).min(1).max(1000).transform(ids => [...new Set(ids)])

export const responseSchema = z.object({
  decision: z.enum(['keep', 'remove']),
  comment: z.string().trim().max(2000).optional()
}).refine(r => r.decision === 'keep' || (r.comment?.length ?? 0) > 0, {
  message: 'Le commentaire est obligatoire quand l\'accès doit être retiré',
  path: ['comment']
})

export const assignSchema = z.object({
  itemIds: itemIdsSchema,
  assigneeId: z.uuid()
})

export const closeItemsSchema = z.object({
  itemIds: itemIdsSchema
})

export const sessionStatusSchema = z.object({
  status: z.enum(['open', 'closed'])
})

export const remediationDoneSchema = z.object({
  note: z.string().trim().max(1000).optional()
})

export const userSearchSchema = z.object({
  q: z.string().trim().min(2).max(100)
})

export type ResponseInput = z.infer<typeof responseSchema>
