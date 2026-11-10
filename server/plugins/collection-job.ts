import { defineNitroPlugin } from 'nitropack/runtime'
import { useRuntimeConfig } from 'nuxt/server'
import { z } from 'zod'
import { runCollectionById } from '../services/collectionLauncher'
import { useDb } from '../utils/db'

/**
 * Mode tâche Cloud Run Job : quand NUXT_COLLECTION_RUN_ID est défini (posé par le lancement du Job),
 * le conteneur exécute cette collecte puis s'arrête. Sans cette variable, le serveur fonctionne normalement.
 */
export default defineNitroPlugin(() => {
  const { collectionRunId } = useRuntimeConfig()
  if (!collectionRunId) return

  setImmediate(async () => {
    let code = 0
    try {
      const runId = z.uuid().parse(collectionRunId)
      console.log('Collecte : démarrage de la tâche', runId)
      if (!(await runCollectionById(useDb(), runId))) {
        console.error('Collecte introuvable ou déjà terminée :', runId)
        code = 1
      } else {
        console.log('Collecte : tâche terminée', runId)
      }
    } catch (error) {
      console.error('Collecte : tâche en échec :', error instanceof Error ? error.message : 'erreur inconnue')
      code = 1
    }
    process.exit(code)
  })
})
