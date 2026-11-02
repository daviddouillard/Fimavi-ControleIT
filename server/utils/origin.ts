const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Protection CSRF : une requête qui modifie l'état doit venir de notre propre origine.
 * Le cookie de session est en SameSite=Lax ; cette vérification couvre les cas restants.
 */
export function isAllowedOrigin(method: string, origin: string | undefined, host: string | undefined): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
