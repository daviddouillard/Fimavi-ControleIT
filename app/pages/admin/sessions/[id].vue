<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const UCheckbox = resolveComponent('UCheckbox')
const UBadge = resolveComponent('UBadge')
const UIcon = resolveComponent('UIcon')

const RESOURCE_ICONS: Record<string, string> = { Bibliothèque: 'i-lucide-library', Dossier: 'i-lucide-folder', Fichier: 'i-lucide-file-text' }

/** « Nom <adresse> » → nom et adresse séparés (affichage sur deux lignes). */
function splitBeneficiary(value: string | undefined): { name: string, email: string | null } {
  const match = value?.match(/^(.*?)s*<([^>]+)>$/)
  return match ? { name: match[1]!, email: match[2]! } : { name: value ?? '—', email: null }
}
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

// Filtre
const filters = [
  { label: 'Toutes', value: 'all' },
  { label: 'Sans valideur', value: 'unassigned' },
  { label: 'À réattribuer', value: 'reassign' },
  { label: 'En attente de réponse', value: 'waiting' },
  { label: 'Répondues', value: 'answered' },
  { label: 'Clôturées sans validation', value: 'closed' }
] as const
const filter = ref<(typeof filters)[number]['value']>('all')
const visibleItems = computed(() => (data.value?.items ?? []).filter((item) => {
  switch (filter.value) {
    case 'unassigned': return !item.decision && !item.closedAt && !item.assigneeId
    case 'reassign': return item.decision === 'reassign' && !item.closedAt
    case 'waiting': return !item.decision && !item.closedAt && !!item.assigneeId
    case 'answered': return item.decision === 'keep' || item.decision === 'remove'
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
  { id: 'site', header: 'Site', cell: ({ row }) => h('span', { class: 'whitespace-nowrap font-medium' }, row.original.data.site ?? '—') },
  {
    id: 'resource',
    header: 'Ressource',
    cell: ({ row }) => {
      const data = row.original.data
      const path = data.resource ?? row.original.label
      const parts = path.split(' / ')
      const name = parts.pop() ?? path
      const link = sharepointLink(data)
      return h('div', { class: 'min-w-64 max-w-md 2xl:max-w-xl' }, [
        h('div', { class: 'flex items-start gap-2' }, [
          h(UIcon, { name: RESOURCE_ICONS[data.resourceType ?? ''] ?? 'i-lucide-file', class: 'mt-0.5 size-4 shrink-0 text-muted' }),
          link
            ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', class: 'font-medium break-words hover:underline' }, name)
            : h('span', { class: 'font-medium break-words' }, name)
        ]),
        parts.length ? h('div', { class: 'mt-0.5 pl-6 text-xs text-muted break-words', title: path }, parts.join(' / ')) : null
      ])
    }
  },
  {
    id: 'beneficiary',
    header: 'Bénéficiaire',
    cell: ({ row }) => {
      const { name, email } = splitBeneficiary(row.original.data.beneficiary)
      return h('div', { class: 'min-w-56 max-w-xs 2xl:max-w-sm' }, [
        h('div', { class: 'font-medium break-words' }, name),
        email ? h('div', { class: 'text-xs text-muted break-all' }, email) : null,
        h('div', { class: 'mt-1.5 flex flex-wrap gap-1' }, [row.original.data.access, row.original.data.role]
          .filter(Boolean).map(label => h(UBadge, { color: 'neutral', variant: 'soft', size: 'sm', label })))
      ])
    }
  },
  { accessorKey: 'assigneeName', header: 'Valideur', cell: ({ row }) => h('span', { class: 'block min-w-32' }, row.original.assigneeName ?? '—') },
  {
    id: 'state',
    header: 'État',
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
interface Progress { added?: number, duplicates?: number, sitesDone?: number, sitesTotal?: number, itemsScanned?: number, permissionsChecked?: number, permissionsTotal?: number, site?: string, errors?: { source: string, message: string }[] }
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
const recipients = ref<string[]>([])
watch(() => data.value?.assignees, (list) => {
  recipients.value = (list ?? []).filter(a => a.pending > 0).map(a => a.id)
}, { immediate: true })
function toggleRecipient(userId: string, checked: boolean) {
  recipients.value = checked ? [...new Set([...recipients.value, userId])] : recipients.value.filter(r => r !== userId)
}
function sendEmails() {
  return act(async () => {
    const r = await $fetch(`/api/admin/sessions/${id.value}/notify`, { method: 'POST', body: { recipientIds: recipients.value } })
    return `${r.sent} email(s) envoyé(s)${r.failed ? `, ${r.failed} en échec` : ''}${r.skipped ? `, ${r.skipped} sans ligne en attente` : ''}`
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
          · {{ progress.added ?? 0 }} ligne(s) ajoutée(s)<template v-if="progress.duplicates">, {{ progress.duplicates }} déjà présente(s)</template>
        </p>
        <p v-else-if="run.status === 'succeeded'">
          Terminée le {{ formatDateTime(run.finishedAt) }} : {{ progress.added ?? 0 }} ligne(s) ajoutée(s),
          {{ progress.duplicates ?? 0 }} doublon(s) écarté(s).
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
        :empty="run?.status === 'running' ? 'Collecte en cours…' : 'Aucun partage externe trouvé.'"
        sticky
        :ui="{ th: 'whitespace-nowrap', td: 'whitespace-normal align-top py-3' }"
      />
    </UCard>

    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="font-medium">Valideurs et emails</h2>
            <p class="text-sm text-muted">
              Un email indique à chaque valideur coché combien de lignes l'attendent. Renvoyez-le pour relancer.
            </p>
          </div>
          <UButton
            icon="i-lucide-mail"
            :disabled="session.status !== 'open' || !recipients.length"
            :loading="busy"
            @click="sendEmails"
          >
            Envoyer l'email ({{ recipients.length }})
          </UButton>
        </div>
        <p v-if="session.status === 'draft'" class="mt-2 text-sm text-muted">Ouvrez la session pour pouvoir envoyer les emails.</p>
      </template>
      <p v-if="!data.assignees.length" class="text-sm text-muted">Aucune ligne assignée pour l'instant.</p>
      <table v-else class="w-full text-sm">
        <thead class="text-left text-muted">
          <tr>
            <th class="w-8 py-1" />
            <th class="py-1">Valideur</th>
            <th class="py-1">En attente</th>
            <th class="py-1">Lignes</th>
            <th class="py-1">Dernier email</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in data.assignees" :key="a.id" class="border-t border-default">
            <td class="py-1">
              <UCheckbox
                :model-value="recipients.includes(a.id)"
                :disabled="!a.pending"
                :aria-label="`Envoyer l'email à ${a.displayName}`"
                @update:model-value="(v: boolean | 'indeterminate') => toggleRecipient(a.id, v === true)"
              />
            </td>
            <td class="py-1">{{ a.displayName }} <span class="text-muted">{{ a.mail }}</span></td>
            <td class="py-1">{{ a.pending }}</td>
            <td class="py-1">{{ a.total }}</td>
            <td class="py-1">{{ a.lastSentAt ? `${formatDateTime(a.lastSentAt)} (${a.emailsSent} envoi(s))` : 'Jamais' }}</td>
          </tr>
        </tbody>
      </table>
      <details v-if="data.notifications.length" class="mt-4 text-sm">
        <summary class="cursor-pointer">Historique des emails ({{ data.notifications.length }})</summary>
        <ul class="mt-2 space-y-1">
          <li v-for="n in data.notifications" :key="n.id">
            <span class="text-muted">{{ formatDateTime(n.sentAt) }}</span> · {{ n.recipientName }} · {{ n.pendingCount }} ligne(s)
            · {{ n.status === 'sent' ? 'envoyé' : `échec (${n.error})` }} · par {{ n.sentByName }}
          </li>
        </ul>
      </details>
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
