import { defineEventHandler, useRuntimeConfig } from 'nuxt/server'
import { requireAdmin } from '../../../../utils/authz'
import { gandiAccessMessage, gandiClient } from '../../../../utils/gandi'

/** Vérifie que le jeton Gandi permet de lire les noms de domaine de l'organisation (lecture seule, nombre seul renvoyé). */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  try {
    const domains = await gandiClient(useRuntimeConfig().gandiToken).listDomains()
    return { ok: true, domains: domains.length }
  } catch (error) {
    const message = gandiAccessMessage(error)
    console.error('Test Gandi en échec :', message)
    return { ok: false, message }
  }
})
