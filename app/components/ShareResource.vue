<script setup lang="ts">
/** Ressource SharePoint d'une ligne : icône du type, nom (lien SharePoint) et chemin. Données collectées, jamais de v-html. */
const props = withDefaults(defineProps<{ data: Record<string, string>, label?: string, large?: boolean }>(), { label: '', large: false })

const ICONS: Record<string, string> = { Bibliothèque: 'i-lucide-library', Dossier: 'i-lucide-folder', Fichier: 'i-lucide-file-text' }

const path = computed(() => props.data.resource ?? props.label)
const parts = computed(() => path.value.split(' / '))
const name = computed(() => parts.value.at(-1) ?? path.value)
const parent = computed(() => parts.value.slice(0, -1).join(' / '))
const icon = computed(() => ICONS[props.data.resourceType ?? ''] ?? 'i-lucide-file')
const link = computed(() => sharepointLink(props.data))
</script>

<template>
  <div class="flex items-start gap-3">
    <div
      class="flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
      :class="large ? 'size-11' : 'size-8'"
    >
      <UIcon :name="icon" :class="large ? 'size-5' : 'size-4'" />
    </div>
    <div class="min-w-0">
      <a
        v-if="link"
        :href="link"
        target="_blank"
        rel="noopener noreferrer"
        class="font-medium break-words hover:underline"
        :class="large && 'text-base font-semibold'"
      >{{ name }}</a>
      <p v-else class="font-medium break-words" :class="large && 'text-base font-semibold'">{{ name }}</p>
      <p v-if="parent || data.resourceType" class="mt-0.5 text-xs text-muted break-words" :title="path">
        <span v-if="data.resourceType">{{ data.resourceType }}</span>
        <span v-if="data.resourceType && parent"> · </span>
        <span v-if="parent">{{ parent }}</span>
      </p>
    </div>
  </div>
</template>
