<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { responseSchema } from '#shared/schemas/checks'

const UButton = resolveComponent('UButton')
const toast = useToast()

const { data: checks, status, refresh } = await useFetch('/api/me/checks', { default: () => [] })
type Check = (typeof checks.value)[number]
type Decision = 'keep' | 'remove' | 'reassign'

const todo = computed(() => checks.value.filter(c => !c.decision && c.sessionStatus === 'open'))
const done = computed(() => checks.value.filter(c => c.decision))

const CHOICES: { value: Decision, label: string, description: string, placeholder: string }[] = [
  { value: 'keep', label: 'Valider le partage', description: 'Le partage est légitime et doit être conservé.', placeholder: 'Pourquoi ce partage est-il nécessaire ?' },
  { value: 'remove', label: 'Arrêter le partage', description: 'L\'IT retirera cet accès.', placeholder: 'Pourquoi ce partage doit-il être arrêté ?' },
  { value: 'reassign', label: 'Mauvaise attribution', description: 'Cette ligne ne me concerne pas : elle repart à l\'IT.', placeholder: 'Qui devrait répondre à ma place ?' }
]

// Fenêtre de réponse
const current = ref<Check | null>(null)
const form = reactive<{ decision: Decision | undefined, comment: string }>({ decision: undefined, comment: '' })
const saving = ref(false)
const choice = computed(() => CHOICES.find(c => c.value === form.decision))
const canSubmit = computed(() => responseSchema.safeParse({ decision: form.decision, comment: form.comment }).success)

function openResponse(check: Check) {
  current.value = check
  form.decision = check.decision ?? undefined
  form.comment = check.comment ?? ''
}

async function submit() {
  const parsed = responseSchema.safeParse({ decision: form.decision, comment: form.comment })
  if (!current.value || !parsed.success) return
  saving.value = true
  try {
    await $fetch(`/api/me/checks/${current.value.id}/response`, { method: 'PUT', body: parsed.data })
    if (parsed.data.decision === 'reassign') toast.add({ title: 'Ligne renvoyée à l\'IT', description: 'Elle n\'apparaît plus dans votre liste.', color: 'success' })
    current.value = null
    await refresh()
  } catch {
    toast.add({ title: 'Réponse non enregistrée', description: 'Réessayez ou contactez l\'IT.', color: 'error' })
  } finally {
    saving.value = false
  }
}

const columns: TableColumn<Check>[] = [
  { accessorKey: 'sessionName', header: 'Session' },
  { accessorKey: 'label', header: 'Partage à vérifier' },
  { accessorKey: 'decision', header: 'Réponse', cell: ({ row }) => row.original.decision ? DECISION_LABELS[row.original.decision] : 'À faire' },
  { accessorKey: 'comment', header: 'Commentaire' },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => row.original.sessionStatus === 'open'
      ? h(UButton, {
          size: 'sm',
          variant: row.original.decision ? 'outline' : 'solid',
          label: row.original.decision ? 'Modifier' : 'Répondre',
          onClick: () => openResponse(row.original)
        })
      : null
  }
]
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold">Mes vérifications</h1>
      <p class="text-muted">
        Pour chaque partage externe, validez-le, demandez son arrêt, ou signalez qu'il ne vous concerne pas.
        Un commentaire est toujours demandé.
      </p>
    </div>

    <UCard>
      <template #header>
        <h2 class="font-medium">À faire ({{ todo.length }})</h2>
      </template>
      <UTable :data="todo" :columns="columns" :loading="status === 'pending'" empty="Aucune vérification en attente." />
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-medium">Déjà répondues ({{ done.length }})</h2>
        <p class="text-sm text-muted">Vous pouvez changer d'avis tant que la session est ouverte.</p>
      </template>
      <UTable :data="done" :columns="columns" empty="Aucune réponse pour l'instant." />
    </UCard>

    <UModal :open="current !== null" title="Vérifier ce partage" @update:open="v => { if (!v) current = null }">
      <template #body>
        <div v-if="current" class="space-y-4">
          <div>
            <p class="font-medium break-all">{{ current.label }}</p>
            <p class="text-sm text-muted">{{ current.sessionName }}</p>
          </div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <template v-for="field in itemFields(current.data)" :key="field.label">
              <dt class="text-muted">{{ field.label }}</dt>
              <dd class="break-all">{{ field.value }}</dd>
            </template>
          </dl>
          <ULink v-if="sharepointLink(current.data)" :to="sharepointLink(current.data)!" target="_blank" rel="noopener noreferrer" class="text-sm">
            Ouvrir dans SharePoint
          </ULink>

          <form id="response-form" class="space-y-4" @submit.prevent="submit">
            <URadioGroup
              v-model="form.decision"
              legend="Votre réponse"
              :items="CHOICES.map(c => ({ label: c.label, description: c.description, value: c.value }))"
            />
            <UFormField v-if="choice" label="Commentaire (obligatoire)" :hint="`${form.comment.length}/2000`">
              <UTextarea v-model="form.comment" class="w-full" :rows="3" :maxlength="2000" :placeholder="choice.placeholder" />
            </UFormField>
          </form>
        </div>
      </template>
      <template #footer>
        <UButton type="submit" form="response-form" :loading="saving" :disabled="!canSubmit">
          Enregistrer
        </UButton>
      </template>
    </UModal>
  </div>
</template>
