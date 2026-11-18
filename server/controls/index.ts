import { useRuntimeConfig } from 'nuxt/server'
import type { ControlTemplate } from '../../shared/schemas/session'
import { exchangeClient } from '../utils/exchange'
import { gandiClient } from '../utils/gandi'
import { graphClient } from '../utils/graph'
import { sharedMailboxModule } from './exchange-shared-mailboxes'
import { gandiDomainsModule } from './gandi-domains'
import { sharepointModule } from './sharepoint-external'
import type { ControlModule } from './types'

/** Modèles de contrôle disponibles (architecture plugin : un dossier par modèle). */
export function controlModule(template: string): ControlModule {
  const modules: Record<ControlTemplate, () => ControlModule> = {
    'sharepoint-external': () => sharepointModule({ graphFor: tenant => graphClient(tenant) }),
    'exchange-shared-mailboxes': () => sharedMailboxModule({ exchangeFor: (tenant, anchor) => exchangeClient(tenant, anchor) }),
    'gandi-domains': () => gandiDomainsModule({ gandi: () => gandiClient(useRuntimeConfig().gandiToken) })
  }
  const factory = modules[template as ControlTemplate]
  if (!factory) throw new Error(`Modèle de contrôle inconnu : ${template}`)
  return factory()
}
