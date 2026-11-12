<script setup lang="ts">
import { CONTROL_TEMPLATES, type CreateSessionInput } from '#shared/schemas/session'
import ShareBeneficiary from '~/components/ShareBeneficiary.vue'
import ShareResource from '~/components/ShareResource.vue'

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

type SessionRow = (typeof sessions.value)[number]
const percent = (s: SessionRow) => s.totalItems ? Math.round(((s.answered + s.closedWithoutValidation) / s.totalItems) * 100) : 0
const sessionStats = (s: SessionRow) => [
  { label: 'En attente', value: s.waiting, icon: 'i-lucide-hourglass', color: 'text-warning' },
  { label: 'Sans valideur', value: s.unassigned, icon: 'i-lucide-user-plus', color: 'text-info' },
  { label: 'À réattribuer', value: s.toReassign, icon: 'i-lucide-user-round-x', color: 'text-warning' },
  { label: 'À retirer', value: s.remediationsTodo, icon: 'i-lucide-shield-x', color: 'text-error' }
]
const kpis = computed(() => [
  { label: 'Réponses en attente', value: totals.value.pending, icon: 'i-lucide-hourglass', tone: 'bg-warning/10 text-warning' },
  { label: 'Lignes à (ré)attribuer', value: totals.value.unassigned, icon: 'i-lucide-user-plus', tone: 'bg-info/10 text-info' },
  { label: 'Accès à retirer (IT)', value: remediations.value.length, icon: 'i-lucide-shield-x', tone: 'bg-error/10 text-error' }
])
</script>

<template>
  <div class="space-y-8">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-4">
        <div class="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <UIcon name="i-lucide-layout-dashboard" class="size-6" />
        </div>
        <div>
          <h1 class="text-2xl font-semibold">Tableau de bord</h1>
          <p class="text-muted">Campagnes de contrôle en cours et accès à retirer.</p>
        </div>
      </div>
      <div class="flex gap-2">
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="outline" :loading="syncing" @click="syncDirectory">
          Synchroniser l'annuaire
        </UButton>
        <UButton icon="i-lucide-plus" @click="openCreate">Nouvelle session</UButton>
      </div>
    </div>

    <div class="grid gap-4 sm:grid-cols-3">
      <div v-for="kpi in kpis" :key="kpi.label" class="flex items-center gap-4 rounded-xl border border-default bg-default p-5">
        <div class="flex size-12 items-center justify-center rounded-xl" :class="kpi.tone">
          <UIcon :name="kpi.icon" class="size-6" />
        </div>
        <div>
          <p class="text-3xl font-semibold leading-none">{{ kpi.value }}</p>
          <p class="mt-1 text-sm text-muted">{{ kpi.label }}</p>
        </div>
      </div>
    </div>

    <section class="space-y-4">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-folder-kanban" class="size-5 text-primary" />
        <h2 class="text-lg font-semibold">Sessions en cours ({{ active.length }})</h2>
      </div>
      <div v-if="status !== 'pending' && !active.length" class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-default py-10 text-center text-muted">
        <UIcon name="i-lucide-folder-open" class="size-8" />
        Aucune session en cours.
        <UButton icon="i-lucide-plus" variant="soft" class="mt-2" @click="openCreate">Créer une session</UButton>
      </div>
      <div class="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <NuxtLink
          v-for="s in active"
          :key="s.id"
          :to="`/admin/sessions/${s.id}`"
          class="group flex flex-col gap-4 rounded-xl border border-default bg-default p-5 transition hover:border-primary hover:shadow-md"
        >
          <div class="flex items-start gap-3">
            <div class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UIcon name="i-lucide-share-2" class="size-5" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-lg font-semibold break-words group-hover:text-primary">{{ s.name }}</p>
              <p class="text-sm text-muted">{{ templateLabel(s.template) }} · créée le {{ formatDate(s.createdAt) }}</p>
            </div>
            <UBadge :color="SESSION_STATUS_LABELS[s.status].color" variant="subtle" size="lg">
              {{ SESSION_STATUS_LABELS[s.status].label }}
            </UBadge>
          </div>

          <div>
            <div class="mb-1.5 flex items-baseline justify-between text-sm">
              <span class="text-muted">Avancement</span>
              <span><strong class="text-base">{{ percent(s) }} %</strong> <span class="text-muted">· {{ s.answered + s.closedWithoutValidation }} / {{ s.totalItems }} lignes traitées</span></span>
            </div>
            <UProgress :model-value="s.answered + s.closedWithoutValidation" :max="Math.max(s.totalItems, 1)" size="md" />
          </div>

          <div class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div v-for="stat in sessionStats(s)" :key="stat.label" class="rounded-lg bg-elevated/60 px-3 py-2">
              <p class="flex items-center gap-1.5 text-xs text-muted">
                <UIcon :name="stat.icon" class="size-3.5" :class="stat.value ? stat.color : ''" /> {{ stat.label }}
              </p>
              <p class="text-lg font-semibold" :class="stat.value ? stat.color : 'text-muted'">{{ stat.value }}</p>
            </div>
          </div>

          <span class="flex items-center gap-1 text-sm font-medium text-primary">
            Ouvrir la session <UIcon name="i-lucide-arrow-right" class="size-4 transition group-hover:translate-x-0.5" />
          </span>
        </NuxtLink>
      </div>
    </section>

    <section class="space-y-4">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-shield-x" class="size-5 text-error" />
          <h2 class="text-lg font-semibold">Accès à retirer ({{ remediations.length }})</h2>
        </div>
        <p class="text-sm text-muted">Retirez l'accès dans SharePoint, puis cliquez sur « Fait ».</p>
      </div>
      <div v-if="!remediations.length" class="flex items-center gap-3 rounded-xl border border-dashed border-default p-5 text-muted">
        <UIcon name="i-lucide-party-popper" class="size-6" /> Rien à retirer pour le moment.
      </div>
      <ul v-else class="space-y-3">
        <li v-for="r in remediations" :key="r.id" class="grid gap-4 rounded-xl border border-default bg-default p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start">
          <ShareResource :data="r.data" :label="r.label" />
          <ShareBeneficiary :data="r.data" />
          <div class="text-sm">
            <p class="flex items-center gap-1.5 text-muted"><UIcon name="i-lucide-message-square-quote" class="size-4" /> {{ r.respondedByName ?? 'Valideur inconnu' }} · {{ r.sessionName }}</p>
            <p class="mt-1 line-clamp-3 break-words" :title="r.comment ?? ''">« {{ r.comment }} »</p>
          </div>
          <UButton icon="i-lucide-check" :loading="handling === r.id" :disabled="handling !== null" @click="markDone(r.id)">Fait</UButton>
        </li>
      </ul>
    </section>

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
