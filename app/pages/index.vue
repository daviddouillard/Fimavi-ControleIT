<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import ShareBeneficiary from '~/components/ShareBeneficiary.vue'
import ShareResource from '~/components/ShareResource.vue'
import { responseSchema } from '#shared/schemas/checks'

const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')
const toast = useToast()

const { data: checks, status, refresh } = await useFetch('/api/me/checks', { default: () => [] })
type Check = (typeof checks.value)[number]
type Decision = 'keep' | 'remove' | 'reassign'

const todo = computed(() => checks.value.filter(c => !c.decision && c.sessionStatus === 'open'))
const done = computed(() => checks.value.filter(c => c.decision))

const CHOICES: { value: Decision, label: string, description: string, placeholder: string, icon: string, color: 'success' | 'error' | 'warning' }[] = [
  { value: 'keep', label: 'Valider le partage', description: 'Le partage est légitime et doit être conservé.', placeholder: 'Pourquoi ce partage est-il nécessaire ?', icon: 'i-lucide-shield-check', color: 'success' },
  { value: 'remove', label: 'Arrêter le partage', description: 'L\'IT retirera cet accès.', placeholder: 'Pourquoi ce partage doit-il être arrêté ?', icon: 'i-lucide-shield-x', color: 'error' },
  { value: 'reassign', label: 'Mauvaise attribution', description: 'Cette ligne ne me concerne pas : elle repart à l\'IT.', placeholder: 'Qui devrait répondre à ma place ?', icon: 'i-lucide-user-round-x', color: 'warning' }
]
const choiceOf = (decision: Decision | null | undefined) => CHOICES.find(c => c.value === decision)

// Fenêtre de réponse
const current = ref<Check | null>(null)
const form = reactive<{ decision: Decision | undefined, comment: string }>({ decision: undefined, comment: '' })
const saving = ref(false)
const choice = computed(() => choiceOf(form.decision))
const canSubmit = computed(() => responseSchema.safeParse({ decision: form.decision, comment: form.comment }).success)

/** Informations complémentaires de la ligne (la ressource et le bénéficiaire sont affichés à part). */
const DETAIL_ICONS: Record<string, string> = { 'Tenant': 'i-lucide-building-2', 'Site': 'i-lucide-globe', 'Expiration': 'i-lucide-calendar-clock', 'Partagé par': 'i-lucide-user-pen' }
const details = computed(() => current.value ? itemFields(current.value.data).filter(f => f.label in DETAIL_ICONS) : [])

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
    toast.add(parsed.data.decision === 'reassign'
      ? { title: 'Ligne renvoyée à l\'IT', description: 'Elle n\'apparaît plus dans votre liste.', color: 'success' }
      : { title: 'Réponse enregistrée', color: 'success' })
    current.value = null
    await refresh()
  } catch {
    toast.add({ title: 'Réponse non enregistrée', description: 'Réessayez ou contactez l\'IT.', color: 'error' })
  } finally {
    saving.value = false
  }
}

const columns: TableColumn<Check>[] = [
  { accessorKey: 'sessionName', header: 'Campagne', cell: ({ row }) => h('span', { class: 'font-medium' }, row.original.sessionName) },
  { id: 'resource', header: 'Ressource partagée', cell: ({ row }) => h('div', { class: 'min-w-64 max-w-md' }, [h(ShareResource, { data: row.original.data, label: row.original.label })]) },
  { id: 'beneficiary', header: 'Partagé avec', cell: ({ row }) => h('div', { class: 'min-w-56 max-w-xs' }, [h(ShareBeneficiary, { data: row.original.data })]) },
  {
    accessorKey: 'decision',
    header: 'Réponse',
    cell: ({ row }) => {
      const c = choiceOf(row.original.decision)
      return c
        ? h(UBadge, { color: c.color, variant: 'soft', icon: c.icon, label: DECISION_LABELS[c.value] })
        : h(UBadge, { color: 'neutral', variant: 'soft', icon: 'i-lucide-hourglass', label: 'À faire' })
    }
  },
  {
    accessorKey: 'comment',
    header: 'Commentaire',
    cell: ({ row }) => row.original.comment ? h('p', { class: 'min-w-40 max-w-xs line-clamp-3 break-words', title: row.original.comment }, row.original.comment) : '—'
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => row.original.sessionStatus === 'open'
      ? h(UButton, {
          size: 'sm',
          variant: row.original.decision ? 'outline' : 'solid',
          icon: row.original.decision ? 'i-lucide-pencil' : 'i-lucide-message-square-reply',
          label: row.original.decision ? 'Modifier' : 'Répondre',
          onClick: () => openResponse(row.original)
        })
      : null
  }
]
const tableUi = { th: 'whitespace-nowrap', td: 'whitespace-normal align-top py-4' }
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start gap-4">
      <div class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <UIcon name="i-lucide-list-checks" class="size-6" />
      </div>
      <div>
        <h1 class="text-2xl font-semibold">Mes vérifications</h1>
        <p class="text-muted">
          Pour chaque partage externe, validez-le, demandez son arrêt, ou signalez qu'il ne vous concerne pas.
          Un commentaire est toujours demandé.
        </p>
      </div>
    </div>

    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-hourglass" class="size-5 text-warning" />
          <h2 class="font-medium">À faire ({{ todo.length }})</h2>
        </div>
      </template>
      <UTable :data="todo" :columns="columns" :loading="status === 'pending'" :ui="tableUi" empty="Aucune vérification en attente." />
    </UCard>

    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-circle-check" class="size-5 text-success" />
          <h2 class="font-medium">Déjà répondues ({{ done.length }})</h2>
        </div>
        <p class="mt-1 text-sm text-muted">Vous pouvez changer d'avis tant que la campagne est ouverte.</p>
      </template>
      <UTable :data="done" :columns="columns" :ui="tableUi" empty="Aucune réponse pour l'instant." />
    </UCard>

    <UModal
      :open="current !== null"
      title="Vérifier ce partage"
      :description="current?.sessionName"
      :ui="{ content: 'sm:max-w-2xl' }"
      @update:open="v => { if (!v) current = null }"
    >
      <template #body>
        <div v-if="current" class="space-y-6">
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="rounded-xl border border-default p-4">
              <p class="mb-3 text-xs font-medium uppercase tracking-wide text-muted">Ressource partagée</p>
              <ShareResource :data="current.data" :label="current.label" large />
            </div>
            <div class="rounded-xl border border-default p-4">
              <p class="mb-3 text-xs font-medium uppercase tracking-wide text-muted">Partagé avec</p>
              <ShareBeneficiary :data="current.data" />
            </div>
          </div>

          <div v-if="details.length" class="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span v-for="d in details" :key="d.label" class="flex items-center gap-1.5">
              <UIcon :name="DETAIL_ICONS[d.label]!" class="size-4 text-muted" />
              <span class="text-muted">{{ d.label }} :</span> {{ d.value }}
            </span>
          </div>

          <USeparator />

          <form id="response-form" class="space-y-5" @submit.prevent="submit">
            <URadioGroup
              v-model="form.decision"
              legend="Votre réponse"
              variant="card"
              indicator="hidden"
              orientation="horizontal"
              :color="choice?.color ?? 'primary'"
              :items="CHOICES.map(c => ({ label: c.label, description: c.description, value: c.value, icon: c.icon }))"
              :ui="{ fieldset: 'grid gap-3 sm:grid-cols-3', item: 'items-start p-4', legend: 'mb-3 font-medium', icon: 'size-7 mb-1' }"
            />
            <UFormField v-if="choice" label="Commentaire (obligatoire)" :hint="`${form.comment.length}/2000`">
              <UTextarea v-model="form.comment" class="w-full" :rows="4" autoresize :maxlength="2000" :placeholder="choice.placeholder" />
            </UFormField>
          </form>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="current = null">Annuler</UButton>
          <UButton type="submit" form="response-form" icon="i-lucide-check" :loading="saving" :disabled="!canSubmit">
            Enregistrer
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
