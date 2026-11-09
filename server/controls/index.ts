import type { ControlTemplate } from '../../shared/schemas/session'
import { graphClient } from '../utils/graph'
import { sharepointModule } from './sharepoint-external'
import type { ControlModule } from './types'

/** Modèles de contrôle disponibles (architecture plugin : un dossier par modèle). */
export function controlModule(template: string): ControlModule {
  const modules: Record<ControlTemplate, () => ControlModule> = {
    'sharepoint-external': () => sharepointModule({ graphFor: tenant => graphClient(tenant) })
  }
  const factory = modules[template as ControlTemplate]
  if (!factory) throw new Error(`Modèle de contrôle inconnu : ${template}`)
  return factory()
}
