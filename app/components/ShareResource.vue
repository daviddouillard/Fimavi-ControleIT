<script setup lang="ts">
import { sageAccountType } from '#shared/sageAccounts'

/**
 * Ressource d'une ligne : élément SharePoint (icône du type, nom avec lien SharePoint, chemin) ou boîte partagée
 * (nom, adresse, tenant), service Gandi (domaine, certificat, hébergement) ou dossier Sage (compte, type de compte).
 * Données collectées, jamais de v-html.
 */
const props = withDefaults(defineProps<{ data: Record<string, string>, label?: string, large?: boolean }>(), { label: '', large: false })

const ICONS: Record<string, string> = { Bibliothèque: 'i-lucide-library', Dossier: 'i-lucide-folder', Fichier: 'i-lucide-file-text' }
const GANDI_ICONS: Record<string, string> = { 'Certificat SSL': 'i-lucide-shield-check', 'Hébergement web': 'i-lucide-server' }

const mailbox = computed(() => !!props.data.mailbox)
const domain = computed(() => !!props.data.domain)
const sage = computed(() => !!props.data.sageDossier)
const path = computed(() => sage.value ? props.data.sageDossier! : domain.value ? props.data.domain! : mailbox.value ? props.data.mailboxName || props.data.mailbox! : props.data.resource ?? props.label)
const parts = computed(() => sage.value ? [path.value] : path.value.split(' / '))
const name = computed(() => parts.value.at(-1) ?? path.value)
const parent = computed(() => {
  if (sage.value) return account.value!.label
  if (domain.value) return [props.data.product, props.data.domainOwner ?? props.data.hostingDomain].filter(Boolean).join(' · ')
  return mailbox.value ? [props.data.mailbox, props.data.tenant].filter(Boolean).join(' · ') : parts.value.slice(0, -1).join(' / ')
})
const icon = computed(() => sage.value ? (account.value!.privileged ? 'i-lucide-shield-alert' : 'i-lucide-database') : domain.value ? GANDI_ICONS[props.data.gandiKind ?? ''] ?? 'i-lucide-globe' : mailbox.value ? 'i-lucide-inbox' : ICONS[props.data.resourceType ?? ''] ?? 'i-lucide-file')
const link = computed(() => mailbox.value || domain.value || sage.value ? null : sharepointLink(props.data))
/** Compte Sage : administrateur ou ComptaAdm en rouge, sinon « Compte classique » (le nom réel du compte reste dans le détail). */
const account = computed(() => sage.value ? sageAccountType(props.data.sageLogin) : null)
const danger = computed(() => !!account.value?.privileged)
const kind = computed(() => sage.value ? 'Dossier Sage' : domain.value ? props.data.gandiKind ?? 'Nom de domaine' : mailbox.value ? 'Boîte partagée' : props.data.resourceType)
</script>

<template>
  <div class="flex items-start gap-3">
    <div
      class="flex shrink-0 items-center justify-center rounded-lg"
      :class="[large ? 'size-11' : 'size-8', danger ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary']"
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
      <p v-if="parent || kind" class="mt-0.5 text-xs text-muted break-words" :title="path">
        <span v-if="kind">{{ kind }}</span>
        <span v-if="kind && parent"> · </span>
        <span v-if="parent" :class="danger && 'font-medium text-error'">{{ parent }}</span>
      </p>
    </div>
  </div>
</template>
