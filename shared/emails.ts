import { FIELD_NAME, FIELD_PENDING, textToDoc, type RichNode } from './richText'

/** Email « vous avez des vérifications à faire » : textes par défaut, modifiables par l'admin avant envoi. */

export const defaultEmailSubject = (sessionName: string) => `ControleIT : partages externes à vérifier — ${sessionName}`

export const DEFAULT_EMAIL_MESSAGE = [
  `Bonjour ${FIELD_NAME},`,
  '',
  FIELD_PENDING,
  '',
  'Le service informatique vous a confié des partages externes SharePoint à vérifier.',
  '',
  'Pour chaque ligne, indiquez si le partage doit être conservé ou arrêté, ou signalez qu\'il ne vous concerne pas. Un commentaire est demandé à chaque réponse.',
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

/** Corps par défaut de l'email : message puis signature, dans un seul document de l'éditeur. */
export const defaultEmailDoc = (): RichNode => {
  const message = textToDoc(DEFAULT_EMAIL_MESSAGE)
  return { type: 'doc', content: [...(message.content ?? []), ...structuredClone(DEFAULT_SIGNATURE)] }
}

/**
 * Phrase ajoutée automatiquement à chaque email, avec le nombre de lignes du destinataire.
 * Un destinataire ajouté à la main (sans ligne assignée) reçoit une phrase sans compteur.
 */
export const pendingSentence = (pending: number, sessionName: string) => pending > 0
  ? `Vous avez ${pending} vérification${pending > 1 ? 's' : ''} en attente dans la campagne « ${sessionName} ».`
  : `Vous êtes sollicité(e) pour la campagne de vérification « ${sessionName} ».`
