import { defineEventHandler, useRuntimeConfig } from 'nuxt/server'
import { requireAdmin } from '../../../../utils/authz'
import { gandiAccessMessage, gandiClient } from '../../../../utils/gandi'

/**
 * Vérifie ce que le jeton Gandi permet de lire (lecture seule) : nombre de noms de domaine, de certificats SSL
 * et d'hébergements web. Seuls les nombres sont renvoyés ; un type illisible est signalé sans bloquer les autres.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  let client
  try {
    client = gandiClient(useRuntimeConfig().gandiToken)
  } catch (error) {
    return { ok: false, message: gandiAccessMessage(error) }
  }
  const count = async (what: string, read: () => Promise<unknown[]>) => {
    try {
      return { what, count: (await read()).length }
    } catch (error) {
      const message = gandiAccessMessage(error, what)
      console.error('Test Gandi en échec :', what, message)
      return { what, message }
    }
  }
  const results = await Promise.all([
    count('les noms de domaine', client.listDomains),
    count('les certificats SSL', client.listCertificates),
    count('les hébergements web (Simple Hosting)', client.listHostings)
  ])
  const [domains, certificates, hostings] = results
  return {
    ok: results.every(r => r.message === undefined),
    domains: domains!.count,
    certificates: certificates!.count,
    hostings: hostings!.count,
    message: results.find(r => r.message)?.message
  }
})
