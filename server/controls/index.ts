import { useRuntimeConfig } from 'nuxt/server'
import type { ControlTemplate } from '../../shared/schemas/session'
import { exchangeClient } from '../utils/exchange'
import { gandiClient } from '../utils/gandi'
import { graphClient } from '../utils/graph'
import { sageClient } from '../utils/sageApi'
import { homeTenant } from '../utils/tenants'
import { parseSageGroups, sageAccessModule } from './sage-access'
import { sharedMailboxModule } from './exchange-shared-mailboxes'
import { gandiDomainsModule } from './gandi-domains'
import { sharepointModule } from './sharepoint-external'
import type { ControlModule } from './types'

/** Modèles de contrôle disponibles (architecture plugin : un dossier par modèle). */
export function controlModule(template: string): ControlModule {
  const modules: Record<ControlTemplate, () => ControlModule> = {
    'sharepoint-external': () => sharepointModule({ graphFor: tenant => graphClient(tenant) }),
    'exchange-shared-mailboxes': () => sharedMailboxModule({ exchangeFor: (tenant, anchor) => exchangeClient(tenant, anchor) }),
    'gandi-domains': () => gandiDomainsModule({ gandi: () => gandiClient(useRuntimeConfig().gandiToken) }),
    'sage-access': () => {
      const config = useRuntimeConfig()
      return sageAccessModule({
        sage: () => sageClient({ url: config.sageApiUrl, key: config.sageApiKey }),
        graph: () => graphClient(homeTenant()),
        homeTenant: homeTenant(),
        groups: parseSageGroups(config.sageGroups)
      })
    }
  }
  const factory = modules[template as ControlTemplate]
  if (!factory) throw new Error(`Modèle de contrôle inconnu : ${template}`)
  return factory()
}
