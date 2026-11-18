<script setup lang="ts">
/**
 * Bénéficiaire d'un partage (nom, adresse, type d'accès et droit), titulaire d'un accès à une boîte partagée,
 * ou échéance d'un nom de domaine (date, renouvellement automatique).
 */
const props = defineProps<{ data: Record<string, string> }>()

const domain = computed(() => !!props.data.domain)
/** Jours restants avant l'échéance du domaine (négatif : échu). */
const daysLeft = computed(() => props.data.domainExpiresAt ? Math.floor((new Date(props.data.domainExpiresAt).getTime() - Date.now()) / 86_400_000) : null)
const parsed = computed(() => {
  if (domain.value) {
    return { name: props.data.domainExpiresAt ? `Échéance le ${formatDate(props.data.domainExpiresAt)}` : 'Échéance inconnue', email: daysLeft.value === null ? null : daysLeft.value < 0 ? 'Échu' : `Dans ${daysLeft.value} jour(s)` }
  }
  if (props.data.trustee) {
    return props.data.trusteeName ? { name: props.data.trusteeName, email: props.data.trustee } : { name: props.data.trustee, email: null }
  }
  const value = props.data.beneficiary ?? '—'
  const match = value.match(/^(.*?)\s*<([^>]+)>$/)
  return match ? { name: match[1]!, email: match[2]! } : { name: value, email: null }
})
const anonymous = computed(() => props.data.access?.includes('Tout le monde'))
</script>

<template>
  <div class="flex items-start gap-3">
    <UAvatar
      :icon="domain ? 'i-lucide-calendar-clock' : anonymous ? 'i-lucide-globe' : 'i-lucide-user-round'"
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
        <UBadge v-if="data.autorenew" icon="i-lucide-refresh-cw" :color="data.autorenew === 'Activé' ? 'success' : 'warning'" variant="soft" size="sm" :label="`Renouvellement auto ${data.autorenew.toLowerCase()}`" />
        <UBadge v-if="daysLeft !== null && daysLeft < 60" icon="i-lucide-alarm-clock" color="error" variant="soft" size="sm" label="Échéance proche" />
        <UBadge v-if="data.right" icon="i-lucide-key-round" :color="data.rightKey === 'full' ? 'warning' : 'neutral'" variant="soft" size="sm" :label="data.right" />
      </div>
    </div>
  </div>
</template>
