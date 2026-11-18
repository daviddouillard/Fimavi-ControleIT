import { defineEventHandler, useRuntimeConfig } from 'nuxt/server'
import { getSettings } from '../../../services/settings'
import { requireAdmin } from '../../../utils/authz'
import { useDb } from '../../../utils/db'
import { homeTenant } from '../../../utils/tenants'

/** Paramètres : domaines internes, tenants raccordés (avec leur lien de consentement) et sites SharePoint. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const settings = await getSettings(useDb())
  const { clientId, redirectURL } = useRuntimeConfig().oauth.microsoft

  const consentUrl = (tenantId: string) => {
    // Point de consentement v1 : il accorde toutes les permissions déclarées sur l'app registration
    // (Microsoft Graph et Exchange Online), alors que la v2 n'accorde que celles de la ressource demandée.
    const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/adminconsent`)
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectURL }).toString()
    return url.toString()
  }

  return {
    ...settings,
    homeTenantId: homeTenant(),
    connections: settings.connections.map(c => ({ ...c, consentUrl: consentUrl(c.tenantId) }))
  }
})
