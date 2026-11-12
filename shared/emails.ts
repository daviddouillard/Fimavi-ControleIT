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

/** Paragraphes d'un message en texte brut (ligne vide = nouveau paragraphe). */
export function messageParagraphs(message: string): string[][] {
  return message.replace(/\r\n?/g, '\n').split(/\n{2,}/).map(p => p.split('\n')).filter(p => p.some(line => line.trim()))
}

/**
 * Phrase ajoutée automatiquement à chaque email, avec le nombre de lignes du destinataire.
 * Un destinataire ajouté à la main (sans ligne assignée) reçoit une phrase sans compteur.
 */
export const pendingSentence = (pending: number, sessionName: string) => pending > 0
  ? `Vous avez ${pending} vérification${pending > 1 ? 's' : ''} en attente dans la campagne « ${sessionName} ».`
  : `Vous êtes sollicité(e) pour la campagne de vérification « ${sessionName} ».`
