<script setup lang="ts">
import { connectionCreateSchema, domainsSchema, siteCreateSchema } from '#shared/schemas/settings'

const toast = useToast()
const { data: settings, refresh } = await useFetch('/api/admin/settings')

const busy = ref(false)
async function act(action: () => Promise<string | void>) {
  busy.value = true
  try {
    const message = await action()
    if (message) toast.add({ title: message, color: 'success' })
    await refresh()
  } catch (e) {
    const data = (e as { data?: { message?: string, data?: { issues?: { message: string }[] } } }).data
    toast.add({ title: 'Action impossible', description: data?.data?.issues?.[0]?.message ?? data?.message, color: 'error' })
  } finally {
    busy.value = false
  }
}

// Domaines internes : un par ligne, enregistrés en bloc.
const domainsText = ref('')
watch(() => settings.value?.domains, (domains) => { domainsText.value = (domains ?? []).join('\n') }, { immediate: true })
const domainsInput = computed(() => domainsText.value.split(/[\s,;]+/).map(d => d.trim()).filter(Boolean))
const domainsCheck = computed(() => domainsSchema.safeParse({ domains: domainsInput.value }))
function saveDomains() {
  return act(async () => {
    const r = await $fetch('/api/admin/settings/domains', { method: 'PUT', body: { domains: domainsInput.value } })
    return `${r.domains.length} domaine(s) enregistré(s)`
  })
}

// Tenants raccordés
const newConnection = reactive({ name: '', tenantId: '' })
const connectionValid = computed(() => connectionCreateSchema.safeParse(newConnection).success)
function addConnection() {
  return act(async () => {
    await $fetch('/api/admin/settings/connections', { method: 'POST', body: newConnection })
    newConnection.name = ''
    newConnection.tenantId = ''
    return 'Tenant ajouté'
  })
}
function toggleConnection(id: string, enabled: boolean) {
  return act(async () => {
    await $fetch(`/api/admin/settings/connections/${id}`, { method: 'PATCH', body: { enabled } })
    return enabled ? 'Tenant activé' : 'Tenant désactivé'
  })
}
function deleteConnection(id: string) {
  return act(async () => {
    await $fetch(`/api/admin/settings/connections/${id}`, { method: 'DELETE' })
    return 'Tenant retiré'
  })
}
async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  toast.add({ title: 'Lien copié', description: 'À ouvrir par un administrateur global du tenant concerné.', color: 'success' })
}

// Sites SharePoint
function addSite(connectionId: string, event: Event) {
  const formElement = event.target as HTMLFormElement
  const parsed = siteCreateSchema.safeParse({ connectionId, url: String(new FormData(formElement).get('url') ?? '') })
  if (!parsed.success) {
    toast.add({ title: 'Adresse invalide', description: parsed.error.issues[0]?.message, color: 'error' })
    return
  }
  return act(async () => {
    await $fetch('/api/admin/settings/sites', { method: 'POST', body: parsed.data })
    formElement.reset()
    return 'Site ajouté'
  })
}
function toggleSite(id: string, enabled: boolean) {
  return act(async () => {
    await $fetch(`/api/admin/settings/sites/${id}`, { method: 'PATCH', body: { enabled } })
  })
}
function deleteSite(id: string) {
  return act(async () => {
    await $fetch(`/api/admin/settings/sites/${id}`, { method: 'DELETE' })
    return 'Site retiré'
  })
}
const testing = ref<string | null>(null)
async function testSite(id: string) {
  testing.value = id
  try {
    const r = await $fetch<{ ok: boolean, displayName?: string, message?: string }>(`/api/admin/settings/sites/${id}/test`, { method: 'POST' })
    toast.add(r.ok ? { title: `Accès OK : ${r.displayName}`, color: 'success' } : { title: 'Accès impossible', description: r.message, color: 'error' })
    await refresh()
  } finally {
    testing.value = null
  }
}

const sitesOf = (connectionId: string) => (settings.value?.sites ?? []).filter(s => s.connectionId === connectionId)
</script>

<template>
  <div v-if="settings" class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold">Paramètres</h1>
      <p class="text-muted">Domaines du groupe, tenants raccordés et sites SharePoint à contrôler.</p>
    </div>

    <UCard>
      <template #header>
        <h2 class="font-medium">Domaines internes du groupe</h2>
        <p class="text-sm text-muted">Toute adresse email dont le domaine n'est pas dans cette liste est considérée comme externe. Un domaine par ligne.</p>
      </template>
      <div class="space-y-3">
        <UTextarea v-model="domainsText" :rows="6" class="w-full font-mono" placeholder="fimavi.com&#10;filiale.fr" aria-label="Domaines internes" />
        <p v-if="!domainsCheck.success" class="text-sm text-error">{{ domainsCheck.error.issues[0]?.message }}</p>
        <UButton icon="i-lucide-save" :loading="busy" :disabled="!domainsCheck.success" @click="saveDomains">Enregistrer</UButton>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-medium">Tenants et sites SharePoint</h2>
        <p class="text-sm text-muted">
          Ajoutez chaque tenant du groupe (y compris le tenant principal pour ses propres sites), puis ses sites.
          Pour un tenant filiale, un administrateur de ce tenant doit ouvrir le lien de consentement une fois :
          ses collaborateurs pourront alors se connecter et ses sites être analysés (lecture seule).
        </p>
      </template>

      <div class="space-y-6">
        <div v-for="c in settings.connections" :key="c.id" class="space-y-3 rounded-md border border-default p-4">
          <div class="flex flex-wrap items-center gap-3">
            <div class="min-w-48 flex-1">
              <p class="font-medium">
                {{ c.name }}
                <UBadge v-if="c.tenantId === settings.homeTenantId" variant="subtle" color="primary" class="ml-1">Tenant principal</UBadge>
                <UBadge v-if="!c.enabled" variant="subtle" color="neutral" class="ml-1">Désactivé</UBadge>
              </p>
              <p class="font-mono text-xs text-muted">{{ c.tenantId }}</p>
            </div>
            <UButton v-if="c.tenantId !== settings.homeTenantId" size="sm" variant="outline" icon="i-lucide-link" @click="copy(c.consentUrl)">
              Copier le lien de consentement
            </UButton>
            <USwitch :model-value="c.enabled" :disabled="busy" label="Actif" @update:model-value="v => toggleConnection(c.id, v)" />
            <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :disabled="busy || sitesOf(c.id).length > 0" aria-label="Retirer le tenant" @click="deleteConnection(c.id)" />
          </div>

          <ul class="divide-y divide-default">
            <li v-for="site in sitesOf(c.id)" :key="site.id" class="flex flex-wrap items-center gap-3 py-2 text-sm">
              <div class="min-w-48 flex-1">
                <p>{{ site.displayName ?? 'Site non testé' }}</p>
                <p class="break-all text-muted">{{ site.url }}</p>
              </div>
              <span class="text-xs text-muted">{{ site.lastCheckedAt ? `Testé le ${formatDateTime(site.lastCheckedAt)}` : '' }}</span>
              <UButton size="sm" variant="outline" icon="i-lucide-plug" :loading="testing === site.id" @click="testSite(site.id)">Tester</UButton>
              <USwitch :model-value="site.enabled" :disabled="busy" label="Actif" @update:model-value="v => toggleSite(site.id, v)" />
              <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :disabled="busy" aria-label="Retirer le site" @click="deleteSite(site.id)" />
            </li>
          </ul>

          <form class="flex flex-wrap gap-2" @submit.prevent="addSite(c.id, $event)">
            <UInput name="url" class="min-w-72 flex-1" placeholder="https://tenant.sharepoint.com/sites/nom-du-site" aria-label="Adresse du site" />
            <UButton type="submit" icon="i-lucide-plus" variant="outline" :loading="busy">Ajouter le site</UButton>
          </form>
        </div>

        <form class="flex flex-wrap items-end gap-2 border-t border-default pt-4" @submit.prevent="addConnection">
          <UFormField label="Nom du tenant">
            <UInput v-model="newConnection.name" placeholder="Ex. Fimavi, Filiale X" />
          </UFormField>
          <UFormField label="ID du tenant (Entra)">
            <UInput v-model="newConnection.tenantId" class="w-80 font-mono" placeholder="00000000-0000-0000-0000-000000000000" />
          </UFormField>
          <UButton type="submit" icon="i-lucide-plus" :loading="busy" :disabled="!connectionValid">Ajouter le tenant</UButton>
        </form>
      </div>
    </UCard>
  </div>
</template>
