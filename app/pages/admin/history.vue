<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const { data: sessions } = await useFetch('/api/admin/sessions', { default: () => [] })
const { data: audit } = await useFetch('/api/admin/audit', { query: { limit: 100 }, default: () => [] })
const { data: removed } = await useFetch('/api/admin/remediations', { query: { status: 'done' }, default: () => [] })

type Session = (typeof sessions.value)[number]

const columns: TableColumn<Session>[] = [
  { accessorKey: 'name', header: 'Session' },
  { accessorKey: 'template', header: 'Modèle', cell: ({ row }) => templateLabel(row.original.template) },
  { accessorKey: 'status', header: 'Statut', cell: ({ row }) => SESSION_STATUS_LABELS[row.original.status].label },
  { accessorKey: 'createdAt', header: 'Créée le', cell: ({ row }) => formatDate(row.original.createdAt) },
  { accessorKey: 'closedAt', header: 'Clôturée le', cell: ({ row }) => formatDate(row.original.closedAt) },
  {
    accessorKey: 'answered',
    header: 'Traitées',
    cell: ({ row }) => `${row.original.answered + row.original.closedWithoutValidation} / ${row.original.totalItems}`
  }
]

function openSession(_e: Event, row: { original: Session }) {
  navigateTo(`/admin/sessions/${row.original.id}`)
}
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Historique</h1>

    <UCard>
      <template #header>
        <h2 class="font-medium">Toutes les sessions</h2>
      </template>
      <UTable :data="sessions" :columns="columns" empty="Aucune session." class="cursor-pointer" @select="openSession" />
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-medium">Accès retirés ({{ removed.length }})</h2>
      </template>
      <p v-if="!removed.length" class="text-muted">Aucun retrait effectué.</p>
      <ul class="divide-y divide-default text-sm">
        <li v-for="r in removed" :key="r.id" class="py-2">
          <p class="font-medium">{{ r.label }}</p>
          <p class="text-muted">
            {{ r.sessionName }} · retiré le {{ formatDateTime(r.handledAt) }} par {{ r.handledByName ?? '—' }}
            · demandé par {{ r.respondedByName ?? '—' }} : « {{ r.comment }} »
          </p>
        </li>
      </ul>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-medium">Journal d'audit (100 dernières actions)</h2>
      </template>
      <ul class="space-y-2 text-sm">
        <li v-for="entry in audit" :key="entry.id">
          <span class="text-muted">{{ formatDateTime(entry.at) }}</span> · {{ entry.actorName ?? 'Système' }} ·
          {{ auditActionLabel(entry.action) }}
          <NuxtLink v-if="entry.sessionId" :to="`/admin/sessions/${entry.sessionId}`" class="text-primary"> · voir la session</NuxtLink>
        </li>
      </ul>
    </UCard>
  </div>
</template>
