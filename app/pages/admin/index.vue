<script setup lang="ts">
import { CONTROL_TEMPLATES, type CreateSessionInput } from '#shared/schemas/session'

const toast = useToast()
const { data: sessions, refresh, status } = await useFetch('/api/admin/sessions', { default: () => [] })

const active = computed(() => sessions.value.filter(s => s.status !== 'closed'))
const totals = computed(() => active.value.reduce((acc, s) => ({
  pending: acc.pending + s.waiting,
  unassigned: acc.unassigned + s.unassigned + s.toReassign
}), { pending: 0, unassigned: 0 }))

const templateItems = Object.entries(CONTROL_TEMPLATES).map(([value, label]) => ({ value, label }))
const createOpen = ref(false)
const form = reactive<CreateSessionInput>({ name: '', template: 'sharepoint-external', siteIds: [] })
const creating = ref(false)

// Sites SharePoint actifs (paramètres) : tous pré-cochés à l'ouverture de la fenêtre.
const { data: settings, refresh: refreshSettings } = await useFetch('/api/admin/settings', { immediate: false })
const activeSites = computed(() => {
  const enabledTenants = new Map((settings.value?.connections ?? []).filter(c => c.enabled).map(c => [c.id, c.name]))
  return (settings.value?.sites ?? []).filter(site => site.enabled && enabledTenants.has(site.connectionId))
    .map(site => ({ ...site, tenantName: enabledTenants.get(site.connectionId)! }))
})
async function openCreate() {
  await refreshSettings()
  form.siteIds = activeSites.value.map(site => site.id)
  createOpen.value = true
}
function toggleSite(siteId: string, checked: boolean) {
  const current = form.siteIds ?? []
  form.siteIds = checked ? [...new Set([...current, siteId])] : current.filter(s => s !== siteId)
}

async function createSession() {
  creating.value = true
  try {
    const session = await $fetch('/api/admin/sessions', { method: 'POST', body: form })
    createOpen.value = false
    form.name = ''
    await navigateTo(`/admin/sessions/${session.id}`)
  } catch (e) {
    const message = (e as { data?: { message?: string } }).data?.message
    toast.add({ title: 'Création impossible', description: message ?? 'Vérifiez le nom (3 caractères minimum) et les sites.', color: 'error' })
  } finally {
    creating.value = false
  }
}

// Pot commun IT : accès à retirer
const { data: remediations, refresh: refreshRemediations } = await useFetch('/api/admin/remediations', { query: { status: 'todo' }, default: () => [] })
const handling = ref<string | null>(null)
async function markDone(remediationId: string) {
  handling.value = remediationId
  try {
    await $fetch(`/api/admin/remediations/${remediationId}/done`, { method: 'POST', body: {} })
    toast.add({ title: 'Retrait enregistré', description: 'Consultable dans l\'historique.', color: 'success' })
    await Promise.all([refreshRemediations(), refresh()])
  } catch {
    toast.add({ title: 'Action déjà traitée ou introuvable', color: 'error' })
    await refreshRemediations()
  } finally {
    handling.value = null
  }
}

const syncing = ref(false)
async function syncDirectory() {
  syncing.value = true
  try {
    const result = await $fetch('/api/admin/directory/sync', { method: 'POST' })
    const failed = result.tenants.filter(t => t.error)
    toast.add({ title: 'Annuaire synchronisé', description: `${result.count} collaborateurs`, color: failed.length ? 'warning' : 'success' })
    for (const t of failed) toast.add({ title: `Tenant « ${t.name} » non synchronisé`, description: t.error, color: 'error' })
  } catch {
    toast.add({ title: 'Échec de la synchronisation Entra ID', color: 'error' })
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">Tableau de bord</h1>
      <div class="flex gap-2">
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="outline" :loading="syncing" @click="syncDirectory">
          Synchroniser l'annuaire
        </UButton>
        <UButton icon="i-lucide-plus" @click="openCreate">Nouvelle session</UButton>
      </div>
    </div>

    <div class="grid gap-4 sm:grid-cols-3">
      <UCard>
        <p class="text-sm text-muted">Réponses en attente</p>
        <p class="text-3xl font-semibold">{{ totals.pending }}</p>
      </UCard>
      <UCard>
        <p class="text-sm text-muted">Lignes à (ré)attribuer</p>
        <p class="text-3xl font-semibold">{{ totals.unassigned }}</p>
      </UCard>
      <UCard>
        <p class="text-sm text-muted">Accès à retirer (IT)</p>
        <p class="text-3xl font-semibold">{{ remediations.length }}</p>
      </UCard>
    </div>

    <UCard>
      <template #header>
        <h2 class="font-medium">Accès à retirer ({{ remediations.length }})</h2>
        <p class="text-sm text-muted">Retirez l'accès dans SharePoint, puis cliquez sur « Fait ».</p>
      </template>
      <p v-if="!remediations.length" class="text-muted">Rien à retirer pour le moment.</p>
      <ul class="divide-y divide-default">
        <li v-for="r in remediations" :key="r.id" class="flex flex-wrap items-center gap-4 py-3">
          <div class="min-w-48 flex-1">
            <p class="font-medium">{{ r.label }}</p>
            <p class="text-sm text-muted">
              {{ r.sessionName }} · « {{ r.comment }} » — {{ r.respondedByName ?? 'valideur inconnu' }}
            </p>
          </div>
          <UButton icon="i-lucide-check" :loading="handling === r.id" :disabled="handling !== null" @click="markDone(r.id)">Fait</UButton>
        </li>
      </ul>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-medium">Sessions en cours</h2>
      </template>
      <p v-if="status !== 'pending' && !active.length" class="text-muted">Aucune session en cours.</p>
      <ul class="divide-y divide-default">
        <li v-for="s in active" :key="s.id" class="py-3">
          <NuxtLink :to="`/admin/sessions/${s.id}`" class="flex flex-wrap items-center gap-4">
            <div class="min-w-48 flex-1">
              <p class="font-medium">{{ s.name }}</p>
              <p class="text-sm text-muted">{{ templateLabel(s.template) }} · échéance {{ formatDate(s.dueDate) }}</p>
            </div>
            <UBadge :color="SESSION_STATUS_LABELS[s.status].color" variant="subtle">
              {{ SESSION_STATUS_LABELS[s.status].label }}
            </UBadge>
            <div class="w-48">
              <UProgress :model-value="s.answered + s.closedWithoutValidation" :max="Math.max(s.totalItems, 1)" size="sm" />
              <p class="mt-1 text-xs text-muted">
                {{ s.answered + s.closedWithoutValidation }} / {{ s.totalItems }} traitées · {{ s.unassigned }} sans valideur · {{ s.toReassign }} à réattribuer · {{ s.remediationsTodo }} à retirer
              </p>
            </div>
          </NuxtLink>
        </li>
      </ul>
    </UCard>

    <UModal v-model:open="createOpen" title="Nouvelle session de contrôle">
      <template #body>
        <form id="create-session" class="space-y-4" @submit.prevent="createSession">
          <UFormField label="Nom" required>
            <UInput v-model="form.name" class="w-full" placeholder="Ex. Revue accès externes T4 2026" />
          </UFormField>
          <UFormField label="Modèle de contrôle" required>
            <USelect v-model="form.template" :items="templateItems" class="w-full" />
          </UFormField>
          <fieldset v-if="form.template === 'sharepoint-external'" class="space-y-1">
            <legend class="mb-1 text-sm font-medium">Sites SharePoint à analyser</legend>
            <p v-if="!activeSites.length" class="text-sm text-muted">
              Aucun site actif. Déclarez vos sites dans les <ULink to="/admin/settings">paramètres</ULink>.
            </p>
            <div v-else class="max-h-64 space-y-1 overflow-y-auto">
              <UCheckbox
                v-for="site in activeSites"
                :key="site.id"
                :model-value="form.siteIds?.includes(site.id)"
                :label="site.displayName ?? site.url"
                :description="`${site.tenantName} · ${site.url}`"
                @update:model-value="(v: boolean | 'indeterminate') => toggleSite(site.id, v === true)"
              />
            </div>
          </fieldset>
          <p class="text-sm text-muted">La recherche des partages externes démarre dès la création.</p>
        </form>
      </template>
      <template #footer>
        <UButton
          type="submit"
          form="create-session"
          :loading="creating"
          :disabled="form.template === 'sharepoint-external' && !form.siteIds?.length"
        >
          Créer et rechercher les partages
        </UButton>
      </template>
    </UModal>
  </div>
</template>
