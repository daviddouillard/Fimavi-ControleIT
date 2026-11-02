<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { responseSchema } from '#shared/schemas/checks'

const UButton = resolveComponent('UButton')
const toast = useToast()

const { data: checks, status, refresh } = await useFetch('/api/me/checks', { default: () => [] })
type Check = (typeof checks.value)[number]

const todo = computed(() => checks.value.filter(c => !c.decision && c.sessionStatus === 'open'))
const done = computed(() => checks.value.filter(c => c.decision))

// Fenêtre de réponse
const current = ref<Check | null>(null)
const form = reactive<{ decision: 'keep' | 'remove' | undefined, comment: string }>({ decision: undefined, comment: '' })
const saving = ref(false)
const commentMissing = computed(() => form.decision === 'remove' && !form.comment.trim())

function openResponse(check: Check) {
  current.value = check
  form.decision = check.decision ?? undefined
  form.comment = check.comment ?? ''
}

async function submit() {
  const parsed = responseSchema.safeParse({ decision: form.decision, comment: form.comment.trim() || undefined })
  if (!current.value || !parsed.success) return
  saving.value = true
  try {
    await $fetch(`/api/me/checks/${current.value.id}/response`, { method: 'PUT', body: parsed.data })
    current.value = null
    await refresh()
  } catch {
    toast.add({ title: 'Réponse non enregistrée', description: 'Réessayez ou contactez l\'IT.', color: 'error' })
  } finally {
    saving.value = false
  }
}

const decisionLabel = (d: Check['decision']) => d === 'keep' ? 'Oui, conserver' : d === 'remove' ? 'Non, retirer' : 'À faire'

const columns: TableColumn<Check>[] = [
  { accessorKey: 'sessionName', header: 'Session' },
  { accessorKey: 'label', header: 'Accès à vérifier' },
  { accessorKey: 'decision', header: 'Réponse', cell: ({ row }) => decisionLabel(row.original.decision) },
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
      <p class="text-muted">Pour chaque accès externe, indiquez s'il doit être conservé. Un commentaire est demandé si l'accès doit être retiré.</p>
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

    <UModal :open="current !== null" title="Vérifier cet accès" @update:open="v => { if (!v) current = null }">
      <template #body>
        <div v-if="current" class="space-y-4">
          <div>
            <p class="font-medium">{{ current.label }}</p>
            <p class="text-sm text-muted">{{ current.sessionName }}</p>
          </div>
          <dl v-if="Object.keys(current.data).length" class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <template v-for="(value, key) in current.data" :key="key">
              <dt class="text-muted">{{ key }}</dt>
              <dd class="break-all">{{ value }}</dd>
            </template>
          </dl>

          <form id="response-form" class="space-y-4" @submit.prevent="submit">
            <URadioGroup
              v-model="form.decision"
              legend="Cet accès doit-il être conservé ?"
              :items="[{ label: 'Oui, conserver l\'accès', value: 'keep' }, { label: 'Non, retirer l\'accès', value: 'remove' }]"
            />
            <UFormField
              :label="form.decision === 'remove' ? 'Commentaire (obligatoire)' : 'Commentaire (facultatif)'"
              :error="commentMissing ? 'Expliquez pourquoi l\'accès doit être retiré' : undefined"
            >
              <UTextarea v-model="form.comment" class="w-full" :rows="3" :maxlength="2000" />
            </UFormField>
          </form>
        </div>
      </template>
      <template #footer>
        <UButton type="submit" form="response-form" :loading="saving" :disabled="!form.decision || commentMissing">
          Enregistrer
        </UButton>
      </template>
    </UModal>
  </div>
</template>
