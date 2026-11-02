import { createError, getRouterParam, type RequestEvent } from 'nuxt/server'
import { z } from 'zod'

/** Paramètre d'URL au format UUID (400 sinon). */
export function requireUuidParam(event: RequestEvent, name: string): string {
  const parsed = z.uuid().safeParse(getRouterParam(event, name))
  if (!parsed.success) throw createError({ status: 400, message: 'Identifiant invalide' })
  return parsed.data
}
