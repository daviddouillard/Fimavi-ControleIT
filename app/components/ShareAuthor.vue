<script setup lang="ts">
/**
 * Auteur d'un partage (journal d'audit Microsoft 365) et N+1 suggéré comme valideur. Données collectées, sans v-html.
 * `assignable` : l'admin peut cliquer sur l'auteur ou sur le N+1 pour en faire le valideur de la ligne.
 */
const props = withDefaults(defineProps<{ data: Record<string, string>, showSuggestion?: boolean, assignable?: boolean }>(), { showSuggestion: true, assignable: false })
const emit = defineEmits<{ 'pick-author': [address: string], 'pick-suggested': [userId: string] }>()
const probable = computed(() => props.data.sharedByCertain === 'no')
</script>

<template>
  <div v-if="data.sharedBy" class="space-y-1 text-sm">
    <p class="flex items-center gap-1.5 break-all">
      <UIcon name="i-lucide-user-pen" class="size-4 shrink-0 text-muted" />
      <button
        v-if="assignable"
        type="button"
        class="text-left font-medium text-primary hover:underline"
        :title="`Faire de ${data.sharedBy} le valideur de cette ligne`"
        @click="emit('pick-author', data.sharedBy)"
      >
        {{ data.sharedBy }}
      </button>
      <span v-else class="font-medium">{{ data.sharedBy }}</span>
    </p>
    <p class="flex flex-wrap items-center gap-1 text-xs text-muted">
      <span v-if="data.sharedAt">le {{ formatDateTime(data.sharedAt) }}</span>
      <UBadge
        v-if="probable"
        color="warning"
        variant="soft"
        size="sm"
        label="Probable"
        title="Partage trouvé sur cet élément, mais l'événement ne cite pas ce bénéficiaire"
      />
    </p>
    <p v-if="showSuggestion && data.suggestedValidatorName" class="flex items-center gap-1.5 text-xs">
      <UIcon name="i-lucide-user-round-check" class="size-3.5 shrink-0 text-primary" />
      <span>
        <span class="text-muted">N+1 suggéré :</span>
        <button
          v-if="assignable && data.suggestedValidatorId"
          type="button"
          class="text-left text-primary hover:underline"
          :title="`Faire de ${data.suggestedValidatorName} le valideur de cette ligne`"
          @click="emit('pick-suggested', data.suggestedValidatorId)"
        >
          {{ data.suggestedValidatorName }}
        </button>
        <template v-else>{{ data.suggestedValidatorName }}</template>
      </span>
    </p>
  </div>
  <span v-else class="text-sm text-muted" title="Aucun événement de partage dans le journal d'audit (180 jours) ou journal non accessible">Inconnu</span>
</template>
