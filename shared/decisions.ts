/** Réponses du valideur, avec un vocabulaire propre à chaque modèle de contrôle. */
export type Decision = 'keep' | 'remove' | 'reassign'

export interface DecisionWording {
  /** Bouton du choix (ex. « Valider le partage »). */
  action: string
  /** État de la ligne une fois la réponse donnée (ex. « Partage validé »). */
  state: string
  description: string
  placeholder: string
}

const SHAREPOINT: Record<'keep' | 'remove', DecisionWording> = {
  keep: { action: 'Valider le partage', state: 'Partage validé', description: 'Le partage est légitime et doit être conservé.', placeholder: 'Pourquoi ce partage est-il nécessaire ?' },
  remove: { action: 'Arrêter le partage', state: 'Partage à arrêter', description: 'L\'IT retirera cet accès.', placeholder: 'Pourquoi ce partage doit-il être arrêté ?' }
}

const WORDINGS: Record<string, Record<'keep' | 'remove', DecisionWording>> = {
  'sharepoint-external': SHAREPOINT,
  'exchange-shared-mailboxes': {
    keep: { action: 'Conserver l\'accès', state: 'Accès conservé', description: 'Cette personne a toujours besoin de cet accès.', placeholder: 'Pourquoi cet accès est-il nécessaire ?' },
    remove: { action: 'Retirer l\'accès', state: 'Accès à retirer', description: 'L\'IT retirera cet accès.', placeholder: 'Pourquoi cet accès doit-il être retiré ?' }
  },
  'gandi-domains': {
    keep: { action: 'Renouveler le domaine', state: 'À renouveler', description: 'Le domaine sert toujours : il doit être renouvelé.', placeholder: 'À quoi sert ce domaine ?' },
    remove: { action: 'Ne plus renouveler', state: 'À ne plus renouveler', description: 'L\'IT désactivera le renouvellement : le domaine expirera à son échéance.', placeholder: 'Pourquoi ce domaine n\'est-il plus utile ?' }
  }
}

const REASSIGN: DecisionWording = {
  action: 'Mauvaise attribution',
  state: 'Mauvaise attribution',
  description: 'Cette ligne ne me concerne pas : elle repart à l\'IT.',
  placeholder: 'Qui devrait répondre à ma place ?'
}

export function decisionWording(decision: Decision, template?: string | null): DecisionWording {
  if (decision === 'reassign') return REASSIGN
  return (WORDINGS[template ?? ''] ?? SHAREPOINT)[decision]
}
