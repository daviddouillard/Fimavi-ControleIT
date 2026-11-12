<script setup lang="ts">
/** Bénéficiaire d'un partage : nom, adresse, type d'accès et droit. */
const props = defineProps<{ data: Record<string, string> }>()

const parsed = computed(() => {
  const value = props.data.beneficiary ?? '—'
  const match = value.match(/^(.*?)\s*<([^>]+)>$/)
  return match ? { name: match[1]!, email: match[2]! } : { name: value, email: null }
})
const anonymous = computed(() => props.data.access?.includes('Tout le monde'))
</script>

<template>
  <div class="flex items-start gap-3">
    <UAvatar
      :icon="anonymous ? 'i-lucide-globe' : 'i-lucide-user-round'"
      size="md"
      :class="anonymous ? 'bg-error/10 text-error' : 'bg-elevated text-muted'"
    />
    <div class="min-w-0">
      <p class="font-medium break-words">{{ parsed.name }}</p>
      <p v-if="parsed.email" class="text-xs text-muted break-all">{{ parsed.email }}</p>
      <div class="mt-1.5 flex flex-wrap gap-1">
        <UBadge
          v-if="data.access"
          :icon="anonymous ? 'i-lucide-link' : 'i-lucide-user-check'"
          :color="anonymous ? 'error' : 'neutral'"
          variant="soft"
          size="sm"
          :label="data.access"
        />
        <UBadge v-if="data.role" icon="i-lucide-key-round" color="neutral" variant="soft" size="sm" :label="data.role" />
      </div>
    </div>
  </div>
</template>
