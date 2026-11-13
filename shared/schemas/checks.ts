import { z } from 'zod'
import { richDocSchema } from '../richText'

/** Liste d'identifiants de lignes, dédoublonnée. */
export const itemIdsSchema = z.array(z.uuid()).min(1).max(1000).transform(ids => [...new Set(ids)])

/**
 * Réponse du valideur : valider le partage, l'arrêter, ou signaler une mauvaise attribution.
 * Le commentaire est toujours obligatoire (justification, ou personne qui devrait répondre).
 */
export const responseSchema = z.object({
  decision: z.enum(['keep', 'remove', 'reassign']),
  comment: z.string().trim().min(1, 'Le commentaire est obligatoire').max(2000)
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

export const notifySchema = z.object({
  /** Valideurs de la session ayant des lignes en attente. */
  recipientIds: z.array(z.uuid()).max(100).transform(ids => [...new Set(ids)]),
  /** Personnes de l'annuaire ajoutées à la main par l'admin (même email, sans compteur de lignes). */
  extraRecipientIds: z.array(z.uuid()).max(20).default([]).transform(ids => [...new Set(ids)]),
  /** Objet et message modifiables par l'admin. Message et signature : documents de l'éditeur, convertis en HTML par le serveur. */
  subject: z.string().trim().min(1, 'L\'objet est obligatoire').max(200).refine(v => !/[\r\n]/.test(v), 'Objet sur une seule ligne').optional(),
  message: richDocSchema().optional(),
  /** Signature de l'admin : enregistrée pour ses prochains envois (vide = aucune signature). */
  signature: richDocSchema({ allowEmpty: true }).optional()
}).refine(v => v.recipientIds.length + v.extraRecipientIds.length > 0, { message: 'Choisissez au moins un destinataire', path: ['recipientIds'] })

export const userSearchSchema = z.object({
  q: z.string().trim().min(2).max(100)
})

export type ResponseInput = z.infer<typeof responseSchema>
