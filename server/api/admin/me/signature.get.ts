import { defineEventHandler } from 'nuxt/server'
import { getSignature } from '../../../services/notifications'
import { requireAdmin } from '../../../utils/authz'
import { useDb } from '../../../utils/db'

/** Signature d'email enregistrée de l'administrateur connecté (pré-remplie dans la fenêtre d'envoi). */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  return { signature: await getSignature(useDb(), admin.id) }
})
