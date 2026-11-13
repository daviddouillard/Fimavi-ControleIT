import { textToDoc } from './richText'

/** Email « vous avez des vérifications à faire » : textes par défaut, modifiables par l'admin avant envoi. */

export const defaultEmailSubject = (sessionName: string) => `ControleIT : partages externes à vérifier — ${sessionName}`

export const DEFAULT_EMAIL_MESSAGE = [
  'Le service informatique vous a confié des partages externes SharePoint à vérifier.',
  '',
  'Pour chaque ligne, indiquez si le partage doit être conservé ou arrêté, ou signalez qu\'il ne vous concerne pas. Un commentaire est demandé à chaque réponse.',
  '',
  'Merci,',
  'Le service informatique'
].join('\n')

/** Message par défaut sous forme de document de l'éditeur. */
export const defaultEmailDoc = () => textToDoc(DEFAULT_EMAIL_MESSAGE)

/**
 * Phrase ajoutée automatiquement à chaque email, avec le nombre de lignes du destinataire.
 * Un destinataire ajouté à la main (sans ligne assignée) reçoit une phrase sans compteur.
 */
export const pendingSentence = (pending: number, sessionName: string) => pending > 0
  ? `Vous avez ${pending} vérification${pending > 1 ? 's' : ''} en attente dans la campagne « ${sessionName} ».`
  : `Vous êtes sollicité(e) pour la campagne de vérification « ${sessionName} ».`
