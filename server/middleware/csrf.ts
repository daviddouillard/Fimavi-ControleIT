import { createError, defineEventHandler, getRequestHeader } from 'nuxt/server'
import { isAllowedOrigin } from '../utils/origin'

export default defineEventHandler((event) => {
  const origin = getRequestHeader(event, 'origin')
  const host = getRequestHeader(event, 'host')
  if (!isAllowedOrigin(event.req.method, origin, host)) {
    throw createError({ status: 403, message: 'Origine de la requête refusée' })
  }
})
