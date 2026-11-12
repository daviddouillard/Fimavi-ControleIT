import { GraphError, TokenError } from '../utils/graph'

/** Codes Entra (AADSTS) les plus courants lors de la demande d'un jeton applicatif pour un tenant. */
const TOKEN_REASONS: Record<string, string> = {
  AADSTS90002: 'ID de tenant introuvable : vérifiez l\'ID saisi dans les paramètres',
  AADSTS900023: 'ID de tenant invalide : vérifiez l\'ID saisi dans les paramètres',
  AADSTS700016: 'application ControleIT inconnue dans ce tenant : le consentement administrateur n\'y a pas été donné (ou l\'ID de tenant est erroné)',
  AADSTS7000215: 'secret client de l\'application invalide',
  AADSTS7000222: 'secret client de l\'application expiré',
  AADSTS53003: 'connexion de l\'application bloquée par une stratégie d\'accès conditionnel du tenant'
}

/** Message d'erreur explicite pour le test d'un site (aucun jeton ni donnée de réponse n'y figure). */
export function siteAccessMessage(error: unknown): string {
  if (error instanceof TokenError) {
    const reason = error.code ? TOKEN_REASONS[error.code] : undefined
    return `Jeton refusé par Microsoft${error.code ? ` (${error.code})` : ''} : ${reason ?? 'vérifiez l\'ID du tenant et le consentement administrateur'}`
  }
  if (error instanceof GraphError) {
    const code = error.code ? `, ${error.code}` : ''
    if (error.status === 404) return 'Site introuvable : vérifiez l\'URL'
    if (error.status === 401 || error.status === 403) {
      return `Accès au site refusé par SharePoint (${error.status}${code}) : permission Sites.Read.All non prise en compte (patienter quelques minutes après le consentement) ou accès bloqué par le tenant`
    }
    return `Site injoignable (${error.status}${code})`
  }
  return 'Site injoignable'
}
