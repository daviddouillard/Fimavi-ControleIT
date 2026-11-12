<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import ShareAuthor from '~/components/ShareAuthor.vue'
import ShareBeneficiary from '~/components/ShareBeneficiary.vue'
import ShareResource from '~/components/ShareResource.vue'
import { DEFAULT_EMAIL_MESSAGE, defaultEmailSubject, messageParagraphs, pendingSentence } from '#shared/emails'
import { notifySchema } from '#shared/schemas/checks'
import type { DirectoryUser } from '~/composables/useDirectorySearch'

const UCheckbox = resolveComponent('UCheckbox')
const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
const toast = useToast()

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data, error, refresh } = await useFetch(() => `/api/admin/sessions/${id.value}`)
const { data: audit, refresh: refreshAudit } = await useFetch('/api/admin/audit', { query: { sessionId: id }, default: () => [] })

type Item = NonNullable<typeof data.value>['items'][number]

const session = computed(() => data.value?.session)
const editable = computed(() => session.value?.status !== 'closed')
/** Ligne (ré)assignable : sans réponse, ou signalée comme mal attribuée, et non clôturée. */
const isPending = (item: Item) => (!item.decision || item.decision === 'reassign') && !item.closedAt

function itemState(item: Item): { label: string, color: 'neutral' | 'warning' | 'success' | 'error' | 'info' } {
  if (item.closedAt) return { label: 'Clôturée sans validation', color: 'info' }
  if (item.decision === 'keep') return { label: 'Partage validé', color: 'success' }
  if (item.decision === 'remove') return { label: 'Partage à arrêter', color: 'error' }
  if (item.decision === 'reassign') return { label: 'À réattribuer', color: 'warning' }
  if (session.value?.status === 'closed') return { label: 'Sans réponse', color: 'neutral' }
  if (item.assigneeId) return { label: 'En attente', color: 'warning' }
  return { label: 'Sans valideur', color: 'neutral' }
}

// Filtres
const filters = [
  { label: 'Tous les états', value: 'all' },
  { label: 'Sans valideur', value: 'unassigned' },
  { label: 'À réattribuer', value: 'reassign' },
  { label: 'En attente de réponse', value: 'waiting' },
  { label: 'Répondues', value: 'answered' },
  { label: 'Partage validé', value: 'keep' },
  { label: 'Partage à arrêter', value: 'remove' },
  { label: 'Clôturées sans validation', value: 'closed' }
] as const
const filter = ref<(typeof filters)[number]['value']>('all')
const NO_ASSIGNEE = 'Sans valideur'
const search = ref('')
const siteFilter = ref<string[]>([])
const assigneeFilter = ref<string[]>([])
const accessFilter = ref<string[]>([])
const typeFilter = ref<string[]>([])

/** Valeurs distinctes d'un champ, triées, pour les listes de filtres. */
const distinct = (pick: (item: Item) => string | null | undefined) =>
  [...new Set((data.value?.items ?? []).map(pick).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, 'fr'))
const siteOptions = computed(() => distinct(i => i.data.site))
const assigneeOptions = computed(() => [NO_ASSIGNEE, ...distinct(i => i.assigneeName)])
const accessOptions = computed(() => distinct(i => i.data.access))
const typeOptions = computed(() => distinct(i => i.data.resourceType))

const matchesState = (item: Item) => {
  switch (filter.value) {
    case 'unassigned': return !item.decision && !item.closedAt && !item.assigneeId
    case 'reassign': return item.decision === 'reassign' && !item.closedAt
    case 'waiting': return !item.decision && !item.closedAt && !!item.assigneeId
    case 'answered': return item.decision === 'keep' || item.decision === 'remove'
    case 'keep': return item.decision === 'keep'
    case 'remove': return item.decision === 'remove'
    case 'closed': return !!item.closedAt
    default: return true
  }
}
const inList = (selected: string[], value: string | null | undefined) => !selected.length || selected.includes(value ?? '')
const searchText = (item: Item) => [item.label, item.data.resource, item.data.beneficiary, item.data.site, item.data.sharedBy, item.data.suggestedValidatorName, item.assigneeName, item.comment]
  .filter(Boolean).join(' ').toLocaleLowerCase('fr')

// Tri par colonne (clic sur l'en-tête : croissant, puis décroissant).
type SortKey = 'rowNumber' | 'site' | 'resource' | 'beneficiary' | 'author' | 'assignee' | 'state' | 'remediation'
const sort = ref<{ key: SortKey, desc: boolean }>({ key: 'rowNumber', desc: false })
const resourceName = (item: Item) => (item.data.resource ?? item.label).split(' / ').at(-1) ?? ''
const sortValue: Record<SortKey, (item: Item) => string | number> = {
  rowNumber: i => i.rowNumber,
  site: i => i.data.site ?? '',
  resource: resourceName,
  beneficiary: i => i.data.beneficiary ?? '',
  author: i => i.data.sharedBy ?? '￿',
  assignee: i => i.assigneeName ?? '',
  state: i => itemState(i).label,
  remediation: i => i.remediationStatus ?? ''
}
const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' })
function toggleSort(key: SortKey) {
  sort.value = sort.value.key === key ? { key, desc: !sort.value.desc } : { key, desc: false }
}

const visibleItems = computed(() => {
  const term = search.value.trim().toLocaleLowerCase('fr')
  const rows = (data.value?.items ?? []).filter(item => matchesState(item)
    && inList(siteFilter.value, item.data.site)
    && inList(assigneeFilter.value, item.assigneeName ?? NO_ASSIGNEE)
    && inList(accessFilter.value, item.data.access)
    && inList(typeFilter.value, item.data.resourceType)
    && (!term || searchText(item).includes(term)))
  const value = sortValue[sort.value.key]
  const direction = sort.value.desc ? -1 : 1
  return rows.sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    const diff = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(String(va), String(vb))
    return (diff || a.rowNumber - b.rowNumber) * direction
  })
})
const filtersActive = computed(() => filter.value !== 'all' || !!search.value.trim()
  || [siteFilter, assigneeFilter, accessFilter, typeFilter].some(f => f.value.length))
function resetFilters() {
  filter.value = 'all'
  search.value = ''
  siteFilter.value = []
  assigneeFilter.value = []
  accessFilter.value = []
  typeFilter.value = []
}

// Sélection multiple (seules les lignes en attente sont sélectionnables).
// Les clés de rowSelection sont les index dans visibleItems : la sélection est vidée à chaque changement de filtre,
// de tri ou rechargement.
const rowSelection = ref<Record<string, boolean>>({})
const selectedIds = computed<string[]>(() => Object.entries(rowSelection.value)
  .filter(([, selected]) => selected)
  .map(([index]) => visibleItems.value[Number(index)])
  .filter((item): item is Item => !!item && isPending(item))
  .map(item => item.id))
watch([filter, data, search, siteFilter, assigneeFilter, accessFilter, typeFilter, sort], () => { rowSelection.value = {} })

/** En-tête cliquable : trie la colonne, flèche selon le sens. */
const sortHeader = (label: string, key: SortKey) => () => {
  const active = sort.value.key === key
  return h(UButton, {
    'color': 'neutral',
    'variant': 'ghost',
    'size': 'xs',
    'label': label,
    'class': ['-mx-2 font-semibold', active ? 'text-highlighted' : ''],
    'trailingIcon': active ? (sort.value.desc ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down',
    'aria-label': `Trier par ${label}`,
    'onClick': () => toggleSort(key)
  })
}

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
  { accessorKey: 'rowNumber', header: sortHeader('#', 'rowNumber') },
  { id: 'site', header: sortHeader('Site', 'site'), cell: ({ row }) => h('span', { class: 'whitespace-nowrap font-medium' }, row.original.data.site ?? '—') },
  {
    id: 'resource',
    header: sortHeader('Ressource', 'resource'),
    cell: ({ row }) => h('div', { class: 'min-w-64 max-w-md 2xl:max-w-xl' }, [h(ShareResource, { data: row.original.data, label: row.original.label })])
  },
  {
    id: 'beneficiary',
    header: sortHeader('Bénéficiaire', 'beneficiary'),
    cell: ({ row }) => h('div', { class: 'min-w-56 max-w-xs 2xl:max-w-sm' }, [h(ShareBeneficiary, { data: row.original.data })])
  },
  {
    id: 'author',
    header: sortHeader('Partagé par', 'author'),
    cell: ({ row }) => h('div', { class: 'min-w-44 max-w-xs' }, [h(ShareAuthor, { data: row.original.data })])
  },
  { accessorKey: 'assigneeName', header: sortHeader('Valideur', 'assignee'), cell: ({ row }) => h('span', { class: 'block min-w-32' }, row.original.assigneeName ?? '—') },
  {
    id: 'state',
    header: sortHeader('État', 'state'),
    cell: ({ row }) => {
      const state = itemState(row.original)
      return h(UBadge, { color: state.color, variant: 'subtle', label: state.label })
    }
  },
  {
    accessorKey: 'comment',
    header: 'Commentaire',
    cell: ({ row }) => {
      const text = row.original.decision === 'reassign' && row.original.comment
        ? `${row.original.respondedByName ?? 'Valideur'} : « ${row.original.comment} »`
        : row.original.comment ?? ''
      return text ? h('p', { class: 'min-w-40 max-w-xs line-clamp-3 break-words', title: text }, text) : '—'
    }
  },
  {
    accessorKey: 'remediationStatus',
    header: sortHeader('Action IT', 'remediation'),
    cell: ({ row }) => ({ todo: 'À retirer', done: 'Retiré', cancelled: 'Annulée' } as const)[row.original.remediationStatus ?? 'x' as never] ?? '—'
  }
]

// Recherche du valideur (annuaire synchronisé depuis Entra ID)
const assignee = ref<DirectoryUser>()
const { searchTerm, items: userItems, searching } = useDirectorySearch()

const busy = ref(false)
async function act(action: () => Promise<string>) {
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
  return act(async () => {
    const r = await $fetch(`/api/admin/sessions/${id.value}/assign`, { method: 'POST', body: { itemIds: selectedIds.value, assigneeId } })
    return `${r.assigned} ligne(s) assignée(s)${r.skipped ? `, ${r.skipped} ignorée(s)` : ''}`
  })
}

// Assignation au N+1 de l'auteur du partage (suggestion issue du journal d'audit) : l'admin choisit les lignes.
const suggestedGroups = computed(() => {
  const groups = new Map<string, string[]>()
  for (const itemId of selectedIds.value) {
    const suggested = data.value?.items.find(i => i.id === itemId)?.data.suggestedValidatorId
    if (suggested) groups.set(suggested, [...(groups.get(suggested) ?? []), itemId])
  }
  return groups
})
const suggestedCount = computed(() => [...suggestedGroups.value.values()].reduce((n, ids) => n + ids.length, 0))
function assignSuggested() {
  const groups = [...suggestedGroups.value]
  return act(async () => {
    let assigned = 0
    for (const [assigneeId, itemIds] of groups) {
      assigned += (await $fetch(`/api/admin/sessions/${id.value}/assign`, { method: 'POST', body: { itemIds, assigneeId } })).assigned
    }
    return `${assigned} ligne(s) assignée(s) au N+1 suggéré`
  })
}

const confirmClose = ref(false)
function closeItems() {
  confirmClose.value = false
  return act(async () => {
    const r = await $fetch(`/api/admin/sessions/${id.value}/close-items`, { method: 'POST', body: { itemIds: selectedIds.value } })
    return `${r.closed} ligne(s) clôturée(s) sans validation`
  })
}

const confirmStatus = ref<'open' | 'closed' | null>(null)
function changeStatus() {
  const status = confirmStatus.value
  confirmStatus.value = null
  if (!status) return
  return act(async () => {
    await $fetch(`/api/admin/sessions/${id.value}/status`, { method: 'POST', body: { status } })
    return status === 'open' ? 'Session ouverte : les valideurs voient leurs lignes' : 'Session clôturée'
  })
}

const unanswered = computed(() => (data.value?.items ?? []).filter(isPending).length)

// Collecte des partages (en arrière-plan côté serveur) : avancement interrogé toutes les 3 secondes.
type Run = NonNullable<NonNullable<typeof data.value>['run']>
interface Progress { authors?: 'running' | 'done' | 'failed', authorsFound?: number, added?: number, duplicates?: number, sitesDone?: number, sitesTotal?: number, itemsScanned?: number, permissionsChecked?: number, permissionsTotal?: number, site?: string, errors?: { source: string, message: string }[] }
const run = ref<Run | null>(null)
watch(() => data.value?.run, (value) => { run.value = value ?? null }, { immediate: true })
const progress = computed(() => (run.value?.progress ?? {}) as Progress)
let poll: ReturnType<typeof setInterval> | undefined
watch(() => run.value?.status, (status) => {
  clearInterval(poll)
  if (status !== 'running' || import.meta.server) return
  poll = setInterval(async () => {
    const r = await $fetch(`/api/admin/sessions/${id.value}/collection`).catch(() => null)
    if (!r?.run) return
    run.value = r.run as unknown as Run
    if (r.run.status !== 'running') await Promise.all([refresh(), refreshAudit()])
  }, 3000)
}, { immediate: true })
onBeforeUnmount(() => clearInterval(poll))

function relaunch() {
  return act(async () => {
    await $fetch(`/api/admin/sessions/${id.value}/collect`, { method: 'POST' })
    return 'Collecte relancée'
  })
}

// Emails aux valideurs (envoi initial et relances)
// Emails aux valideurs : fenêtre de préparation (destinataires, objet, message modifiables).
// Destinataires : tous les valideurs ayant au moins une ligne sans réponse (envoi initial comme relance).
const pendingAssignees = computed(() => (data.value?.assignees ?? []).filter(a => a.pending > 0))
const answeredAssignees = computed(() => (data.value?.assignees ?? []).filter(a => a.pending === 0))
const emailOpen = ref(false)
const email = reactive<{ recipientIds: string[], extras: DirectoryUser[], subject: string, message: string }>({ recipientIds: [], extras: [], subject: '', message: '' })
function openEmail() {
  email.recipientIds = pendingAssignees.value.map(a => a.id)
  email.extras = []
  email.subject = defaultEmailSubject(session.value?.name ?? '')
  email.message = DEFAULT_EMAIL_MESSAGE
  emailOpen.value = true
}
function toggleRecipient(userId: string, checked: boolean) {
  email.recipientIds = checked ? [...new Set([...email.recipientIds, userId])] : email.recipientIds.filter(r => r !== userId)
}
function toggleAllRecipients() {
  email.recipientIds = email.recipientIds.length === pendingAssignees.value.length ? [] : pendingAssignees.value.map(a => a.id)
}
// Destinataires ajoutés à la main (recherche dans l'annuaire, comme pour l'assignation).
const { searchTerm: extraSearch, items: extraItems, searching: extraSearching } = useDirectorySearch()
const extraPick = ref<DirectoryUser>()
watch(extraPick, (user) => {
  if (!user) return
  // Un valideur en attente est simplement coché ; les autres personnes s'ajoutent à la liste.
  if (pendingAssignees.value.some(a => a.id === user.id)) toggleRecipient(user.id, true)
  else if (!email.extras.some(e => e.id === user.id)) email.extras = [...email.extras, user]
  nextTick(() => {
    extraPick.value = undefined
    extraSearch.value = ''
  })
})
function removeExtra(userId: string) {
  email.extras = email.extras.filter(e => e.id !== userId)
}
const recipientCount = computed(() => email.recipientIds.length + email.extras.length)
const emailPayload = computed(() => ({
  recipientIds: email.recipientIds,
  extraRecipientIds: email.extras.map(e => e.id),
  subject: email.subject,
  message: email.message
}))
const canSendEmail = computed(() => session.value?.status === 'open' && notifySchema.safeParse(emailPayload.value).success)
const preview = computed(() => {
  const first = pendingAssignees.value.find(a => email.recipientIds.includes(a.id))
  if (first) return { name: first.displayName, pending: first.pending }
  return { name: email.extras[0]?.displayName ?? 'Prénom Nom', pending: email.extras.length ? 0 : 1 }
})
const previewParagraphs = computed(() => messageParagraphs(email.message))
function sendEmails() {
  const parsed = notifySchema.safeParse(emailPayload.value)
  if (!parsed.success) return
  return act(async () => {
    const r = await $fetch(`/api/admin/sessions/${id.value}/notify`, { method: 'POST', body: parsed.data })
    emailOpen.value = false
    if (r.failed) toast.add({ title: `${r.failed} email(s) en échec`, description: 'Voir le détail dans l\'historique des emails.', color: 'error' })
    return `${r.sent} email(s) envoyé(s)${r.skipped ? `, ${r.skipped} sans ligne en attente` : ''}`
  })
}
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

    <UCard v-if="run">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="font-medium">Collecte des partages</h2>
          <UButton
            v-if="session.status === 'draft' && run.status !== 'running'"
            icon="i-lucide-refresh-cw"
            variant="outline"
            :loading="busy"
            @click="relaunch"
          >
            Relancer la collecte
          </UButton>
        </div>
      </template>
      <div class="space-y-2 text-sm">
        <p v-if="run.status === 'running'" class="flex flex-wrap items-center gap-2">
          <UIcon name="i-lucide-loader-circle" class="animate-spin" />
          En cours : site {{ Math.min((progress.sitesDone ?? 0) + 1, progress.sitesTotal ?? 1) }}/{{ progress.sitesTotal ?? '?' }}
          <span v-if="progress.site" class="text-muted break-all">({{ progress.site }})</span>
          · {{ progress.itemsScanned ?? 0 }} éléments parcourus
          <template v-if="progress.permissionsTotal">· partages analysés {{ progress.permissionsChecked ?? 0 }}/{{ progress.permissionsTotal }}</template>
          <template v-if="progress.authors === 'running'">· recherche des auteurs dans le journal d'audit Microsoft 365…</template>
          · {{ progress.added ?? 0 }} ligne(s) ajoutée(s)<template v-if="progress.duplicates">, {{ progress.duplicates }} déjà présente(s)</template>
        </p>
        <p v-else-if="run.status === 'succeeded'">
          Terminée le {{ formatDateTime(run.finishedAt) }} : {{ progress.added ?? 0 }} ligne(s) ajoutée(s),
          {{ progress.duplicates ?? 0 }} doublon(s) écarté(s)<template v-if="progress.authors === 'done'">, auteur trouvé pour {{ progress.authorsFound ?? 0 }} ligne(s)</template>.
        </p>
        <p v-else class="text-error">Échec de la collecte : {{ run.error }}</p>
        <ul v-if="progress.errors?.length" class="text-error">
          <li v-for="e in progress.errors" :key="e.source" class="break-all">{{ e.source }} : {{ e.message }}</li>
        </ul>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="font-medium">
            Lignes à vérifier
            <span class="text-muted">({{ visibleItems.length === data.items.length ? data.items.length : `${visibleItems.length} / ${data.items.length}` }})</span>
          </h2>
          <UButton v-if="filtersActive" size="sm" color="neutral" variant="link" icon="i-lucide-filter-x" @click="resetFilters">
            Réinitialiser les filtres
          </UButton>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <UInput
            v-model="search"
            icon="i-lucide-search"
            placeholder="Rechercher (ressource, bénéficiaire, valideur…)"
            aria-label="Rechercher dans les lignes"
            class="w-full sm:w-80"
          />
          <USelect v-model="filter" :items="[...filters]" icon="i-lucide-list-filter" aria-label="Filtrer par état" class="w-56" />
          <USelectMenu v-model="siteFilter" :items="siteOptions" multiple icon="i-lucide-globe" placeholder="Tous les sites" aria-label="Filtrer par site" class="w-48" />
          <USelectMenu v-model="assigneeFilter" :items="assigneeOptions" multiple icon="i-lucide-user-round" placeholder="Tous les valideurs" aria-label="Filtrer par valideur" class="w-56" />
          <USelectMenu v-model="accessFilter" :items="accessOptions" multiple icon="i-lucide-link" placeholder="Tous les accès" aria-label="Filtrer par type d'accès" class="w-56" />
          <USelectMenu v-model="typeFilter" :items="typeOptions" multiple icon="i-lucide-folder" placeholder="Tous les types" aria-label="Filtrer par type de ressource" class="w-44" />
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
        <UButton
          v-if="suggestedCount"
          variant="soft"
          :loading="busy"
          icon="i-lucide-user-round-check"
          @click="assignSuggested"
        >
          Assigner au N+1 suggéré ({{ suggestedCount }})
        </UButton>
        <UButton color="neutral" variant="outline" :loading="busy" icon="i-lucide-circle-check" @click="confirmClose = true">
          Clôturer sans validation
        </UButton>
      </div>

      <UTable
        v-model:row-selection="rowSelection"
        :data="visibleItems"
        :columns="columns"
        :row-selection-options="{ enableRowSelection: row => editable && isPending(row.original) }"
        :empty="run?.status === 'running' ? 'Collecte en cours…' : filtersActive ? 'Aucune ligne ne correspond aux filtres.' : 'Aucun partage externe trouvé.'"
        sticky
        :ui="{ th: 'whitespace-nowrap', td: 'whitespace-normal align-top py-3' }"
      />
    </UCard>

    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div class="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UIcon name="i-lucide-users-round" class="size-5" />
            </div>
            <div>
              <h2 class="font-medium">Valideurs et emails</h2>
              <p class="text-sm text-muted">Prévenez les valideurs qu'ils ont des lignes à vérifier. Renvoyez l'email pour relancer.</p>
            </div>
          </div>
          <UButton icon="i-lucide-mail" @click="openEmail">
            Préparer l'email
          </UButton>
        </div>
        <UAlert
          v-if="session.status === 'draft'"
          class="mt-3"
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          description="Ouvrez la session pour pouvoir envoyer les emails."
        />
      </template>
      <div v-if="!data.assignees.length" class="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted">
        <UIcon name="i-lucide-user-plus" class="size-8" />
        Aucune ligne assignée pour l'instant.
      </div>
      <ul v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <li v-for="a in data.assignees" :key="a.id" class="flex items-start gap-3 rounded-lg border border-default p-3">
          <UAvatar :alt="a.displayName" size="md" />
          <div class="min-w-0 flex-1">
            <p class="font-medium">{{ a.displayName }}</p>
            <p class="text-xs text-muted break-all">{{ a.mail ?? 'Adresse inconnue' }}</p>
            <div class="mt-2 flex flex-wrap gap-1">
              <UBadge :color="a.pending ? 'warning' : 'success'" variant="soft" size="sm" :icon="a.pending ? 'i-lucide-hourglass' : 'i-lucide-check'">
                {{ a.pending ? `${a.pending} en attente` : 'Tout traité' }} / {{ a.total }}
              </UBadge>
              <UBadge color="neutral" variant="soft" size="sm" icon="i-lucide-mail">
                {{ a.lastSentAt ? `Dernier email ${formatDateTime(a.lastSentAt)}` : 'Jamais prévenu' }}
              </UBadge>
            </div>
          </div>
        </li>
      </ul>
      <details v-if="data.notifications.length" class="mt-4 text-sm">
        <summary class="cursor-pointer font-medium">Historique des emails ({{ data.notifications.length }})</summary>
        <ul class="mt-3 space-y-2">
          <li v-for="n in data.notifications" :key="n.id" class="flex items-start gap-2">
            <UIcon
              :name="n.status === 'sent' ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
              class="mt-0.5 size-4 shrink-0"
              :class="n.status === 'sent' ? 'text-success' : 'text-error'"
            />
            <span>
              <span class="text-muted">{{ formatDateTime(n.sentAt) }}</span> · {{ n.recipientName }} · {{ n.pendingCount }} ligne(s) · par {{ n.sentByName }}
              <span v-if="n.status !== 'sent'" class="block text-error">{{ n.error }}</span>
            </span>
          </li>
        </ul>
      </details>
    </UCard>

    <UModal v-model:open="emailOpen" title="Prévenir les valideurs" description="Vérifiez les destinataires et le message, puis envoyez." :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <form id="email-form" class="space-y-6" @submit.prevent="sendEmails">
          <UAlert
            v-if="session.status !== 'open'"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :description="session.status === 'draft' ? 'La session est en brouillon : ouvrez-la pour pouvoir envoyer les emails.' : 'La session est clôturée : plus aucun email ne peut être envoyé.'"
          />
          <UAlert
            v-else-if="!pendingAssignees.length"
            color="success"
            variant="subtle"
            icon="i-lucide-circle-check"
            :description="data.assignees.length ? 'Tous les valideurs ont répondu : personne à relancer. Vous pouvez ajouter un destinataire ci-dessous.' : 'Aucune ligne n\'est assignée. Vous pouvez ajouter un destinataire ci-dessous.'"
          />
          <section class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <h3 class="flex items-center gap-2 text-sm font-medium">
                <UIcon name="i-lucide-users-round" class="size-4" /> Destinataires ({{ recipientCount }})
              </h3>
              <UButton v-if="pendingAssignees.length" size="xs" variant="link" color="neutral" @click="toggleAllRecipients">
                {{ email.recipientIds.length === pendingAssignees.length ? 'Tout décocher' : 'Tout cocher' }}
              </UButton>
            </div>
            <ul v-if="pendingAssignees.length || email.extras.length" class="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-default p-2">
              <li v-for="a in pendingAssignees" :key="a.id" class="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-elevated">
                <UCheckbox
                  :model-value="email.recipientIds.includes(a.id)"
                  :aria-label="`Envoyer l'email à ${a.displayName}`"
                  @update:model-value="(v: boolean | 'indeterminate') => toggleRecipient(a.id, v === true)"
                />
                <UAvatar :alt="a.displayName" size="xs" />
                <span class="min-w-0 flex-1">
                  <span class="font-medium">{{ a.displayName }}</span>
                  <span class="ml-2 text-xs text-muted break-all">{{ a.mail }}</span>
                </span>
                <UBadge color="warning" variant="soft" size="sm">{{ a.pending }} en attente</UBadge>
              </li>
              <li v-for="e in email.extras" :key="e.id" class="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-elevated">
                <UIcon name="i-lucide-user-plus" class="size-4 text-primary" />
                <UAvatar :alt="e.displayName" size="xs" />
                <span class="min-w-0 flex-1">
                  <span class="font-medium">{{ e.displayName }}</span>
                  <span class="ml-2 text-xs text-muted break-all">{{ e.mail }}</span>
                </span>
                <UBadge color="primary" variant="soft" size="sm">Ajouté</UBadge>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  :aria-label="`Retirer ${e.displayName} des destinataires`"
                  @click="removeExtra(e.id)"
                />
              </li>
            </ul>
            <USelectMenu
              v-model="extraPick"
              v-model:search-term="extraSearch"
              :items="extraItems"
              :loading="extraSearching"
              label-key="displayName"
              ignore-filter
              icon="i-lucide-user-plus"
              placeholder="Ajouter un destinataire (2 lettres min.)"
              class="w-full sm:w-96"
            />
            <p v-if="answeredAssignees.length" class="text-xs text-muted">
              Déjà à jour, non relancé(s) : {{ answeredAssignees.map(a => a.displayName).join(', ') }}.
            </p>
          </section>

          <UFormField label="Objet" required>
            <UInput v-model="email.subject" icon="i-lucide-text-cursor-input" class="w-full" :maxlength="200" />
          </UFormField>
          <UFormField label="Message" required :hint="`${email.message.length}/5000`">
            <UTextarea v-model="email.message" class="w-full" :rows="7" autoresize :maxlength="5000" />
          </UFormField>

          <section class="space-y-2">
            <h3 class="flex items-center gap-2 text-sm font-medium">
              <UIcon name="i-lucide-eye" class="size-4" /> Aperçu pour {{ preview.name }}
            </h3>
            <div class="space-y-3 rounded-lg border border-default bg-elevated/50 p-4 text-sm">
              <p class="font-medium">{{ email.subject }}</p>
              <p>Bonjour {{ preview.name }},</p>
              <p>
                <span class="font-semibold">{{ pendingSentence(preview.pending, session.name) }}</span><br>
                <span class="text-primary underline">Accéder à mes vérifications</span>
              </p>
              <p v-for="(lines, i) in previewParagraphs" :key="i">
                <template v-for="(line, j) in lines" :key="j"><br v-if="j">{{ line }}</template>
              </p>
            </div>
            <p class="text-xs text-muted">Le nombre de lignes et le lien vers ControleIT sont ajoutés à chaque email (sans nombre pour un destinataire ajouté). Envoi depuis la boîte du service informatique.</p>
          </section>
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="emailOpen = false">Annuler</UButton>
          <UButton type="submit" form="email-form" icon="i-lucide-send" :loading="busy" :disabled="!canSendEmail">
            Envoyer ({{ recipientCount }})
          </UButton>
        </div>
      </template>
    </UModal>

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
