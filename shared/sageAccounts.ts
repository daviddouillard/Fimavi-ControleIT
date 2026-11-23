/** Type d'un compte Sage, d'après son nom (PR_Nom) : les comptes à privilèges sont affichés en rouge. */
export interface SageAccountType {
  label: string
  privileged: boolean
}

const PRIVILEGED: Record<string, string> = {
  '<administrateur>': 'Compte administrateur',
  'administrateur': 'Compte administrateur',
  'comptaadm': 'Compte ComptaAdm'
}

export const SAGE_CLASSIC_ACCOUNT = 'Compte classique'

/** Nom du compte écrit normalement : « <Administrateur> » devient « Administrateur ». */
export const sageLoginText = (login: string) => login.trim().replace(/^<(.+)>$/, '$1')

export function sageAccountType(login: string | null | undefined): SageAccountType {
  const label = PRIVILEGED[(login ?? '').trim().toLowerCase()]
  return label ? { label, privileged: true } : { label: SAGE_CLASSIC_ACCOUNT, privileged: false }
}
