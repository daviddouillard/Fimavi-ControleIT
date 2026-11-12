import type { Database } from '../utils/db'

/** Ligne à vérifier produite par un modèle de contrôle. */
export interface ControlLine {
  /** Clé de dédoublonnage : une seule ligne par clé et par session. */
  dedupKey: string
  label: string
  data: Record<string, string>
}

export interface CollectionContext {
  db: Database
  config: Record<string, unknown>
  internalDomains: ReadonlySet<string>
  addLines: (lines: ControlLine[]) => Promise<void>
  /** Complète les données de lignes déjà ajoutées (ex. auteur du partage), identifiées par leur clé. */
  annotateLines: (patches: { dedupKey: string, data: Record<string, string> }[]) => Promise<void>
  progress: (state: Record<string, unknown>) => Promise<void>
  siteError: (source: string, message: string) => Promise<void>
}

/** Modèle de contrôle (plugin) : sait produire les lignes à vérifier d'une session. */
export interface ControlModule {
  collect: (ctx: CollectionContext) => Promise<void>
}

/** Arrêt demandé (collecte interrompue, session sortie du brouillon) : ne doit pas être traité comme une erreur de site. */
export class CollectionStopped extends Error {
  override name = 'CollectionStopped'
}
