<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data, error } = await useFetch(() => `/api/admin/sessions/${id.value}`)
const { data: audit } = await useFetch('/api/admin/audit', { query: { sessionId: id }, default: () => [] })

type Item = NonNullable<typeof data.value>['items'][number]

const columns: TableColumn<Item>[] = [
  { accessorKey: 'rowNumber', header: '#' },
  { accessorKey: 'label', header: 'Accès' },
  { accessorKey: 'assigneeName', header: 'Valideur', cell: ({ row }) => row.original.assigneeName ?? 'Non assigné' },
  {
    accessorKey: 'decision',
    header: 'Réponse',
    cell: ({ row }) => row.original.decision === 'keep' ? 'Oui' : row.original.decision === 'remove' ? 'Non' : '—'
  },
  { accessorKey: 'comment', header: 'Commentaire' },
  {
    accessorKey: 'remediationStatus',
    header: 'Action IT',
    cell: ({ row }) => row.original.remediationStatus === 'todo' ? 'À retirer' : row.original.remediationStatus === 'done' ? 'Retiré' : '—'
  }
]
</script>

<template>
  <div v-if="error" class="text-muted">Session introuvable.</div>
  <div v-else-if="data" class="space-y-6">
    <div>
      <UButton to="/admin" icon="i-lucide-arrow-left" variant="link" color="neutral" class="px-0">Tableau de bord</UButton>
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-semibold">{{ data.session.name }}</h1>
        <UBadge :color="SESSION_STATUS_LABELS[data.session.status].color" variant="subtle">
          {{ SESSION_STATUS_LABELS[data.session.status].label }}
        </UBadge>
      </div>
      <p class="text-muted">{{ templateLabel(data.session.template) }} · créée le {{ formatDate(data.session.createdAt) }}</p>
    </div>

    <UCard>
      <template #header>
        <h2 class="font-medium">Lignes à vérifier ({{ data.items.length }})</h2>
      </template>
      <UTable :data="data.items" :columns="columns" empty="Aucune ligne importée. L'import CSV arrive dans la prochaine livraison." />
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-medium">Historique de la session</h2>
      </template>
      <ul class="space-y-2 text-sm">
        <li v-for="entry in audit" :key="entry.id">
          <span class="text-muted">{{ formatDateTime(entry.at) }}</span> · {{ entry.actorName ?? 'Système' }} · <code>{{ entry.action }}</code>
        </li>
      </ul>
    </UCard>
  </div>
</template>
