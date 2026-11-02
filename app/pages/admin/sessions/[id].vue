<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const UCheckbox = resolveComponent('UCheckbox')
const UBadge = resolveComponent('UBadge')
const toast = useToast()

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data, error, refresh } = await useFetch(() => `/api/admin/sessions/${id.value}`)
const { data: audit, refresh: refreshAudit } = await useFetch('/api/admin/audit', { query: { sessionId: id }, default: () => [] })

type Item = NonNullable<typeof data.value>['items'][number]

const session = computed(() => data.value?.session)
const editable = computed(() => session.value?.status !== 'closed')
const isPending = (item: Item) => !item.decision && !item.closedAt

function itemState(item: Item): { label: string, color: 'neutral' | 'warning' | 'success' | 'error' | 'info' } {
  if (item.closedAt) return { label: 'Clôturée sans validation', color: 'info' }
  if (item.decision === 'keep') return { label: 'Oui', color: 'success' }
  if (item.decision === 'remove') return { label: 'Non', color: 'error' }
  if (session.value?.status === 'closed') return { label: 'Sans réponse', color: 'neutral' }
  if (item.assigneeId) return { label: 'En attente', color: 'warning' }
  return { label: 'Sans valideur', color: 'neutral' }
}

// Filtre
const filters = [
  { label: 'Toutes', value: 'all' },
  { label: 'Sans valideur', value: 'unassigned' },
  { label: 'En attente de réponse', value: 'waiting' },
  { label: 'Répondues', value: 'answered' },
  { label: 'Clôturées sans validation', value: 'closed' }
] as const
const filter = ref<(typeof filters)[number]['value']>('all')
const visibleItems = computed(() => (data.value?.items ?? []).filter((item) => {
  switch (filter.value) {
    case 'unassigned': return isPending(item) && !item.assigneeId
    case 'waiting': return isPending(item) && !!item.assigneeId
    case 'answered': return !!item.decision
    case 'closed': return !!item.closedAt
    default: return true
  }
}))

// Sélection multiple (seules les lignes en attente sont sélectionnables).
// Les clés de rowSelection sont les index dans visibleItems : la sélection est vidée à chaque changement de filtre ou rechargement.
const rowSelection = ref<Record<string, boolean>>({})
const selectedIds = computed<string[]>(() => Object.entries(rowSelection.value)
  .filter(([, selected]) => selected)
  .map(([index]) => visibleItems.value[Number(index)])
  .filter((item): item is Item => !!item && isPending(item))
  .map(item => item.id))
watch([filter, data], () => { rowSelection.value = {} })

const columns: TableColumn<Item>[] = [
  {
    id: 'select',
    header: ({ table }) => h(UCheckbox, {
      'modelValue': table.getIsSomePageRowsSelected() ? 'indeterminate' : table.getIsAllPageRowsSelected(),
      'onUpdate:modelValue': (value: boolean | 'indeterminate') => table.toggleAllPageRowsSelected(!!value),
      'disabled': !editable.value,
      'aria-label': 'Tout sélectionner'
    }),
    cell: ({ row }) => h(UCheckbox, {
      'modelValue': row.getIsSelected(),
      'onUpdate:modelValue': (value: boolean | 'indeterminate') => row.toggleSelected(!!value),
      'disabled': !row.getCanSelect(),
      'aria-label': 'Sélectionner la ligne'
    })
  },
  { accessorKey: 'rowNumber', header: '#' },
  { accessorKey: 'label', header: 'Accès' },
  { accessorKey: 'assigneeName', header: 'Valideur', cell: ({ row }) => row.original.assigneeName ?? '—' },
  {
    id: 'state',
    header: 'État',
    cell: ({ row }) => {
      const state = itemState(row.original)
      return h(UBadge, { color: state.color, variant: 'subtle', label: state.label })
    }
  },
  { accessorKey: 'comment', header: 'Commentaire' },
  {
    accessorKey: 'remediationStatus',
    header: 'Action IT',
    cell: ({ row }) => ({ todo: 'À retirer', done: 'Retiré', cancelled: 'Annulée' } as const)[row.original.remediationStatus ?? 'x' as never] ?? '—'
  }
]

// Recherche du valideur (annuaire synchronisé depuis Entra ID)
interface DirectoryUser { id: string, displayName: string, mail: string | null, department: string | null }
const assignee = ref<DirectoryUser>()
const searchTerm = ref('')
const userItems = ref<DirectoryUser[]>([])
const searching = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchTerm, (term) => {
  clearTimeout(searchTimer)
  if (term.trim().length < 2) return
  searchTimer = setTimeout(async () => {
    searching.value = true
    try {
      userItems.value = await $fetch<DirectoryUser[]>('/api/admin/users', { query: { q: term.trim() } })
    } finally {
      searching.value = false
    }
  }, 300)
})

const busy = ref(false)
async function run(action: () => Promise<string>) {
  busy.value = true
  try {
    toast.add({ title: await action(), color: 'success' })
    rowSelection.value = {}
    await Promise.all([refresh(), refreshAudit()])
  } catch (e) {
    const message = (e as { data?: { message?: string } }).data?.message
    toast.add({ title: 'Action impossible', description: message, color: 'error' })
  } finally {
    busy.value = false
  }
}

function assign() {
  if (!assignee.value) return
  const assigneeId = assignee.value.id
  return run(async () => {
    const r = await $fetch(`/api/admin/sessions/${id.value}/assign`, { method: 'POST', body: { itemIds: selectedIds.value, assigneeId } })
    return `${r.assigned} ligne(s) assignée(s)${r.skipped ? `, ${r.skipped} ignorée(s)` : ''}`
  })
}

const confirmClose = ref(false)
function closeItems() {
  confirmClose.value = false
  return run(async () => {
    const r = await $fetch(`/api/admin/sessions/${id.value}/close-items`, { method: 'POST', body: { itemIds: selectedIds.value } })
    return `${r.closed} ligne(s) clôturée(s) sans validation`
  })
}

const confirmStatus = ref<'open' | 'closed' | null>(null)
function changeStatus() {
  const status = confirmStatus.value
  confirmStatus.value = null
  if (!status) return
  return run(async () => {
    await $fetch(`/api/admin/sessions/${id.value}/status`, { method: 'POST', body: { status } })
    return status === 'open' ? 'Session ouverte : les valideurs voient leurs lignes' : 'Session clôturée'
  })
}

const unanswered = computed(() => (data.value?.items ?? []).filter(isPending).length)
</script>

<template>
  <div v-if="error" class="text-muted">Session introuvable.</div>
  <div v-else-if="data && session" class="space-y-6">
    <div>
      <UButton to="/admin" icon="i-lucide-arrow-left" variant="link" color="neutral" class="px-0">Tableau de bord</UButton>
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-semibold">{{ session.name }}</h1>
        <UBadge :color="SESSION_STATUS_LABELS[session.status].color" variant="subtle">
          {{ SESSION_STATUS_LABELS[session.status].label }}
        </UBadge>
        <div class="ml-auto flex gap-2">
          <UButton v-if="session.status === 'draft'" icon="i-lucide-play" :loading="busy" @click="confirmStatus = 'open'">Ouvrir la session</UButton>
          <UButton v-if="session.status === 'open'" icon="i-lucide-lock" color="neutral" variant="outline" :loading="busy" @click="confirmStatus = 'closed'">Clôturer la session</UButton>
        </div>
      </div>
      <p class="text-muted">{{ templateLabel(session.template) }} · créée le {{ formatDate(session.createdAt) }}</p>
    </div>

    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="font-medium">Lignes à vérifier ({{ data.items.length }})</h2>
          <USelect v-model="filter" :items="[...filters]" class="w-60" />
        </div>
      </template>

      <div v-if="editable && selectedIds.length" class="mb-4 flex flex-wrap items-center gap-2 rounded-md bg-elevated p-3">
        <span class="text-sm font-medium">{{ selectedIds.length }} ligne(s) sélectionnée(s)</span>
        <USelectMenu
          v-model="assignee"
          v-model:search-term="searchTerm"
          :items="userItems"
          :loading="searching"
          label-key="displayName"
          ignore-filter
          placeholder="Rechercher un valideur (2 lettres min.)"
          class="w-72"
        />
        <UButton :disabled="!assignee" :loading="busy" icon="i-lucide-user-check" @click="assign">Assigner</UButton>
        <UButton color="neutral" variant="outline" :loading="busy" icon="i-lucide-circle-check" @click="confirmClose = true">
          Clôturer sans validation
        </UButton>
      </div>

      <UTable
        v-model:row-selection="rowSelection"
        :data="visibleItems"
        :columns="columns"
        :row-selection-options="{ enableRowSelection: row => editable && isPending(row.original) }"
        empty="Aucune ligne. L'import CSV arrive dans la prochaine livraison."
      />
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-medium">Historique de la session</h2>
      </template>
      <ul class="space-y-2 text-sm">
        <li v-for="entry in audit" :key="entry.id">
          <span class="text-muted">{{ formatDateTime(entry.at) }}</span> · {{ entry.actorName ?? 'Système' }} · {{ auditActionLabel(entry.action) }}
        </li>
      </ul>
    </UCard>

    <UModal v-model:open="confirmClose" title="Clôturer sans validation ?">
      <template #body>
        <p>Les {{ selectedIds.length }} ligne(s) sélectionnée(s) seront considérées comme légitimes sans demande de validation. Elles disparaîtront de la liste des valideurs éventuels.</p>
      </template>
      <template #footer>
        <UButton :loading="busy" @click="closeItems">Confirmer</UButton>
      </template>
    </UModal>

    <UModal :open="confirmStatus !== null" :title="confirmStatus === 'open' ? 'Ouvrir la session ?' : 'Clôturer la session ?'" @update:open="v => { if (!v) confirmStatus = null }">
      <template #body>
        <p v-if="confirmStatus === 'open'">Les valideurs verront les lignes qui leur sont assignées et pourront répondre.</p>
        <p v-else>
          Les valideurs ne pourront plus répondre ni modifier leurs réponses.
          <strong v-if="unanswered">{{ unanswered }} ligne(s) resteront sans réponse.</strong>
          Les accès à retirer restent dans la liste de l'IT.
        </p>
      </template>
      <template #footer>
        <UButton :loading="busy" @click="changeStatus">Confirmer</UButton>
      </template>
    </UModal>
  </div>
</template>
