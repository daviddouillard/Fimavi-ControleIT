<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import ShareBeneficiary from '~/components/ShareBeneficiary.vue'
import ShareResource from '~/components/ShareResource.vue'
import { DEFAULT_EMAIL_MESSAGE, defaultEmailSubject, messageParagraphs, pendingSentence } from '#shared/emails'
import { notifySchema } from '#shared/schemas/checks'

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
    cell: ({ row }) => h('div', { class: 'min-w-64 max-w-md 2xl:max-w-xl' }, [h(ShareResource, { data: row.original.data, label: row.original.label })])
  },
  {
    id: 'beneficiary',
    header: 'Bénéficiaire',
    cell: ({ row }) => h('div', { class: 'min-w-56 max-w-xs 2xl:max-w-sm' }, [h(ShareBeneficiary, { data: row.original.data })])
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
// Emails aux valideurs : fenêtre de préparation (destinataires, objet, message modifiables).
const pendingAssignees = computed(() => (data.value?.assignees ?? []).filter(a => a.pending > 0))
const emailOpen = ref(false)
const email = reactive<{ recipientIds: string[], subject: string, message: string }>({ recipientIds: [], subject: '', message: '' })
function openEmail() {
  email.recipientIds = pendingAssignees.value.map(a => a.id)
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
const canSendEmail = computed(() => notifySchema.safeParse(email).success)
const preview = computed(() => {
  const first = pendingAssignees.value.find(a => email.recipientIds.includes(a.id))
  return { name: first?.displayName ?? 'Prénom Nom', pending: first?.pending ?? 1 }
})
const previewParagraphs = computed(() => messageParagraphs(email.message))
function sendEmails() {
  const parsed = notifySchema.safeParse(email)
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
          <div class="flex items-center gap-3">
            <div class="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UIcon name="i-lucide-users-round" class="size-5" />
            </div>
            <div>
              <h2 class="font-medium">Valideurs et emails</h2>
              <p class="text-sm text-muted">Prévenez les valideurs qu'ils ont des lignes à vérifier. Renvoyez l'email pour relancer.</p>
            </div>
          </div>
          <UButton
            icon="i-lucide-mail"
            :disabled="session.status !== 'open' || !pendingAssignees.length"
            @click="openEmail"
          >
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
          <section class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <h3 class="flex items-center gap-2 text-sm font-medium">
                <UIcon name="i-lucide-users-round" class="size-4" /> Destinataires ({{ email.recipientIds.length }})
              </h3>
              <UButton size="xs" variant="link" color="neutral" @click="toggleAllRecipients">
                {{ email.recipientIds.length === pendingAssignees.length ? 'Tout décocher' : 'Tout cocher' }}
              </UButton>
            </div>
            <ul class="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-default p-2">
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
            </ul>
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
            <p class="text-xs text-muted">Le nombre de lignes et le lien vers ControleIT sont ajoutés à chaque email. Envoi depuis la boîte du service informatique.</p>
          </section>
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="emailOpen = false">Annuler</UButton>
          <UButton type="submit" form="email-form" icon="i-lucide-send" :loading="busy" :disabled="!canSendEmail">
            Envoyer ({{ email.recipientIds.length }})
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
