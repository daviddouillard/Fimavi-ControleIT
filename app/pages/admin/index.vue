<script setup lang="ts">
import { CONTROL_TEMPLATES, type CreateSessionInput } from '#shared/schemas/session'

const toast = useToast()
const { data: sessions, refresh, status } = await useFetch('/api/admin/sessions', { default: () => [] })

const active = computed(() => sessions.value.filter(s => s.status !== 'closed'))
const totals = computed(() => active.value.reduce((acc, s) => ({
  pending: acc.pending + (s.totalItems - s.answered),
  unassigned: acc.unassigned + s.unassigned,
  remediations: acc.remediations + s.remediationsTodo
}), { pending: 0, unassigned: 0, remediations: 0 }))

const templateItems = Object.entries(CONTROL_TEMPLATES).map(([value, label]) => ({ value, label }))
const createOpen = ref(false)
const form = reactive<CreateSessionInput>({ name: '', template: 'sharepoint-external' })
const creating = ref(false)

async function createSession() {
  creating.value = true
  try {
    const session = await $fetch('/api/admin/sessions', { method: 'POST', body: form })
    createOpen.value = false
    form.name = ''
    await navigateTo(`/admin/sessions/${session.id}`)
  } catch {
    toast.add({ title: 'Création impossible', description: 'Vérifiez le nom (3 caractères minimum).', color: 'error' })
  } finally {
    creating.value = false
  }
}

const syncing = ref(false)
async function syncDirectory() {
  syncing.value = true
  try {
    const result = await $fetch('/api/admin/directory/sync', { method: 'POST' })
    toast.add({ title: 'Annuaire synchronisé', description: `${result.count} collaborateurs`, color: 'success' })
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
        <UButton icon="i-lucide-plus" @click="createOpen = true">Nouvelle session</UButton>
      </div>
    </div>

    <div class="grid gap-4 sm:grid-cols-3">
      <UCard>
        <p class="text-sm text-muted">Réponses en attente</p>
        <p class="text-3xl font-semibold">{{ totals.pending }}</p>
      </UCard>
      <UCard>
        <p class="text-sm text-muted">Lignes sans valideur</p>
        <p class="text-3xl font-semibold">{{ totals.unassigned }}</p>
      </UCard>
      <UCard>
        <p class="text-sm text-muted">Accès à retirer (IT)</p>
        <p class="text-3xl font-semibold">{{ totals.remediations }}</p>
      </UCard>
    </div>

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
              <UProgress :model-value="s.answered" :max="Math.max(s.totalItems, 1)" size="sm" />
              <p class="mt-1 text-xs text-muted">{{ s.answered }} / {{ s.totalItems }} répondues · {{ s.remediationsTodo }} à retirer</p>
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
        </form>
      </template>
      <template #footer>
        <UButton type="submit" form="create-session" :loading="creating">Créer</UButton>
      </template>
    </UModal>
  </div>
</template>
