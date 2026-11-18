import { FIELD_NAME, FIELD_PENDING, textToDoc, type RichNode } from './richText'

/** Email « vous avez des vérifications à faire » : textes par défaut, modifiables par l'admin avant envoi. */

const SUBJECTS: Record<string, string> = {
  'exchange-shared-mailboxes': 'accès aux boîtes partagées',
  'gandi-domains': 'services Gandi à renouveler ?'
}

export const defaultEmailSubject = (sessionName: string, template?: string) =>
  `Contrôles IT : ${SUBJECTS[template ?? ''] ?? 'partages externes'}${template === 'gandi-domains' ? '' : ' à vérifier'} — ${sessionName}`

export const DEFAULT_EMAIL_MESSAGE = [
  `Bonjour ${FIELD_NAME},`,
  '',
  FIELD_PENDING,
  '',
  'Je vous ai confié des partages externes SharePoint à vérifier : des fichiers ou des dossiers accessibles à des personnes extérieures au groupe (clients, partenaires, prestataires…), ou à tous ceux qui ont le lien.',
  '',
  'Pourquoi ? Un partage n\'expire pas tout seul : il reste ouvert après la fin d\'un projet ou le départ d\'un interlocuteur. Faire le point régulièrement protège nos données et évite qu\'elles restent accessibles à des personnes qui n\'en ont plus besoin. Vous êtes le mieux placé pour savoir si ces accès sont toujours utiles.',
  '',
  'Ce que je vous demande : pour chaque ligne, indiquez si le partage doit être conservé ou arrêté, ou signalez qu\'il ne vous concerne pas. Ajoutez un court commentaire à chaque réponse. Si vous demandez l\'arrêt, je m\'occupe de retirer l\'accès.',
  '',
  'Merci par avance de votre retour.',
  ''
].join('\n')

/** Message par défaut du modèle « Accès aux boîtes partagées ». */
export const DEFAULT_MAILBOX_EMAIL_MESSAGE = [
  `Bonjour ${FIELD_NAME},`,
  '',
  FIELD_PENDING,
  '',
  'Je vous ai confié des accès à des boîtes aux lettres partagées à vérifier : des personnes qui peuvent lire une boîte partagée (accès total), envoyer des emails en son nom (envoyer en tant que) ou de sa part (envoyer de la part de).',
  '',
  'Pourquoi ? Ces accès restent en place après un changement de poste ou un départ : une personne peut continuer à lire les emails d\'un service ou à écrire en son nom sans en avoir besoin. Faire le point régulièrement protège nos échanges et nos données. Vous êtes le mieux placé pour savoir si ces accès sont toujours justifiés.',
  '',
  'Ce que je vous demande : pour chaque ligne, indiquez si l\'accès doit être conservé ou retiré, ou signalez qu\'il ne vous concerne pas. Ajoutez un court commentaire à chaque réponse. Si vous demandez le retrait, je m\'occupe de retirer l\'accès.',
  '',
  'Merci par avance de votre retour.',
  ''
].join('\n')

/** Message par défaut du modèle « Services Gandi » (domaines, certificats, hébergements). */
export const DEFAULT_DOMAIN_EMAIL_MESSAGE = [
  `Bonjour ${FIELD_NAME},`,
  '',
  FIELD_PENDING,
  '',
  'Je vous ai confié des services Gandi du groupe à vérifier : noms de domaine (adresses de sites web ou d\'emails), certificats SSL et hébergements web, que nous payons et renouvelons chez Gandi.',
  '',
  'Pourquoi ? Ces services se renouvellent, même quand le site, la marque ou le projet n\'existe plus. Faire le point avant chaque échéance évite de payer pour rien, et de laisser expirer un service encore utilisé (site ou emails coupés). Vous êtes le mieux placé pour savoir s\'ils servent toujours.',
  '',
  'Ce que je vous demande : pour chaque ligne, indiquez s\'il faut continuer à la renouveler ou non, ou signalez qu\'elle ne vous concerne pas. Ajoutez un court commentaire à chaque réponse. Si un service n\'est plus utile, je m\'occupe d\'arrêter son renouvellement.',
  '',
  'Merci par avance de votre retour.',
  ''
].join('\n')

/** Signature intégrée au message par défaut (modifiable dans le corps du message avant chaque envoi). */
const DEFAULT_SIGNATURE: RichNode[] = [
  { type: 'paragraph', content: [{ type: 'text', text: 'Cordialement,' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'David DOUILLARD', marks: [{ type: 'bold' }] }] },
  { type: 'paragraph', content: [{ type: 'text', text: '06 59 54 45 10' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Email : david.douillard@fimavi.com' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Fimavi', marks: [{ type: 'bold' }] }, { type: 'text', text: ' Rue verte, ZI de LADOUX 63118 CEBAZAT' }] },
  { type: 'image', attrs: { src: '/signature-fimavi.jpg', alt: 'Groupe Fimavi' } }
]

/** Débuts de paragraphe mis en gras dans le message par défaut. */
const BOLD_LEADS = ['Pourquoi ?', 'Ce que je vous demande :']

/** Corps par défaut de l'email : message du modèle puis signature, dans un seul document de l'éditeur. */
export const defaultEmailDoc = (template?: string): RichNode => {
  const text = template === 'exchange-shared-mailboxes' ? DEFAULT_MAILBOX_EMAIL_MESSAGE : template === 'gandi-domains' ? DEFAULT_DOMAIN_EMAIL_MESSAGE : DEFAULT_EMAIL_MESSAGE
  const message = textToDoc(text).content ?? []
  const content = message.map((paragraph) => {
    const text = paragraph.content?.[0]?.text ?? ''
    const lead = BOLD_LEADS.find(l => text.startsWith(l))
    return lead
      ? { type: 'paragraph', content: [{ type: 'text', text: lead, marks: [{ type: 'bold' }] }, { type: 'text', text: text.slice(lead.length) }] }
      : paragraph
  })
  return { type: 'doc', content: [...content, ...structuredClone(DEFAULT_SIGNATURE)] }
}

/** Prénom pour la salutation : prénom Entra, à défaut le premier mot du nom affiché. */
export const greetingName = (givenName: string | null | undefined, displayName: string) =>
  givenName?.trim() || displayName.trim().split(/\s+/)[0] || displayName

/**
 * Phrase ajoutée automatiquement à chaque email, avec le nombre de lignes du destinataire.
 * Un destinataire ajouté à la main (sans ligne assignée) reçoit une phrase sans compteur.
 */
export const pendingSentence = (pending: number, sessionName: string) => pending > 0
  ? `Vous avez ${pending} vérification${pending > 1 ? 's' : ''} en attente dans la campagne « ${sessionName} ».`
  : `Vous êtes sollicité(e) pour la campagne de vérification « ${sessionName} ».`
