<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const { data: checks, status } = await useFetch('/api/me/checks', { default: () => [] })
type Check = (typeof checks.value)[number]

const todo = computed(() => checks.value.filter(c => !c.decision && c.sessionStatus === 'open'))
const done = computed(() => checks.value.filter(c => c.decision))

const columns: TableColumn<Check>[] = [
  { accessorKey: 'sessionName', header: 'Session' },
  { accessorKey: 'label', header: 'Accès à vérifier' },
  { accessorKey: 'dueDate', header: 'Échéance', cell: ({ row }) => formatDate(row.original.dueDate) },
  {
    accessorKey: 'decision',
    header: 'Réponse',
    cell: ({ row }) => row.original.decision === 'keep' ? 'Oui' : row.original.decision === 'remove' ? 'Non' : 'À faire'
  }
]
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold">Mes vérifications</h1>
      <p class="text-muted">Indiquez pour chaque accès s'il doit être conservé.</p>
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
      </template>
      <UTable :data="done" :columns="columns" empty="Aucune réponse pour l'instant." />
    </UCard>
  </div>
</template>
