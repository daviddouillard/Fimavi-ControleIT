import { defineEventHandler, useRuntimeConfig } from 'nuxt/server'
import { groupErrorMessage, parseSageGroups, readGroupMembers } from '../../../../controls/sage-access'
import { requireAdmin } from '../../../../utils/authz'
import { graphClient } from '../../../../utils/graph'
import { sageAccessMessage, sageClient } from '../../../../utils/sageApi'
import { homeTenant } from '../../../../utils/tenants'

/**
 * Vérifie ce que le modèle « Accès Sage » peut lire (lecture seule) : nombre de comptes et de dossiers Sage
 * renvoyés par l'API, et nombre de membres de chaque groupe Entra Sage. Seuls des nombres et des messages fixes sont renvoyés.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const config = useRuntimeConfig()

  let sage: { accounts?: number, dossiers?: number, message?: string }
  try {
    const logins = await sageClient({ url: config.sageApiUrl, key: config.sageApiKey }).listLogins()
    sage = { accounts: logins.length, dossiers: new Set(logins.map(l => l.IntituleDossier ?? String(l.site ?? ''))).size }
  } catch (error) {
    sage = { message: sageAccessMessage(error) }
    console.error('Test API Sage en échec :', sage.message)
  }

  const graph = graphClient(homeTenant())
  const groups = await Promise.all(parseSageGroups(config.sageGroups).map(async (name) => {
    try {
      return { name, members: (await readGroupMembers(graph, name)).length }
    } catch (error) {
      return { name, message: groupErrorMessage(error) }
    }
  }))

  return {
    ok: !sage.message && groups.every(g => g.message === undefined),
    ...sage,
    groups
  }
})
