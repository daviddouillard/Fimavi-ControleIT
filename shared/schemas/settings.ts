import { z } from 'zod'

const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** Domaines internes du groupe : un par entrée, normalisés en minuscules, sans doublon. */
export const domainsSchema = z.object({
  domains: z.array(z.string().trim().toLowerCase().regex(DOMAIN, 'Domaine invalide (ex. fimavi.com)'))
    .max(200)
    .transform(list => [...new Set(list)].sort())
})

export const tenantGuidSchema = z.string().trim().toLowerCase()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'ID de tenant invalide (GUID attendu)')

export const connectionCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  tenantId: tenantGuidSchema
})

export const connectionUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  enabled: z.boolean().optional()
})

/**
 * URL d'un site SharePoint Online : https://<tenant>.sharepoint.com[/sites|/teams/<nom>].
 * Normalisée (minuscules, sans barre finale, sans paramètres) pour le dédoublonnage.
 */
export const siteUrlSchema = z.string().trim().max(400).transform((value, ctx) => {
  let url: URL
  let path: string
  try {
    url = new URL(value)
    path = decodeURIComponent(url.pathname).replace(/\/+$/, '').toLowerCase()
  } catch {
    ctx.addIssue({ code: 'custom', message: 'URL invalide' })
    return z.NEVER
  }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.sharepoint\.com$/i.test(url.hostname) || url.username || url.password || url.port
    || !(path === '' || /^\/(sites|teams)\/[^/]+$/.test(path))) {
    ctx.addIssue({ code: 'custom', message: 'Adresse attendue : https://<tenant>.sharepoint.com/sites/<nom>' })
    return z.NEVER
  }
  return `https://${url.hostname.toLowerCase()}${path}`
})

export const siteCreateSchema = z.object({
  connectionId: z.uuid(),
  url: siteUrlSchema
})

export const siteUpdateSchema = z.object({
  enabled: z.boolean()
})

export type DomainsInput = z.infer<typeof domainsSchema>
