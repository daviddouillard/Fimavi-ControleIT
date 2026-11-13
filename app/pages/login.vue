<script setup lang="ts">
definePageMeta({ layout: false })
useHead({ title: 'Connexion — Contrôles IT' })

const route = useRoute()
const hasError = computed(() => route.query.error !== undefined)
const errorText = computed(() => route.query.error === 'domain'
  ? 'Votre compte n\'appartient pas à un domaine du groupe autorisé à utiliser Contrôles IT. Contactez l\'IT.'
  : 'La connexion a échoué. Réessayez ou contactez l\'IT.')

const features = [
  { icon: 'i-lucide-share-2', title: 'Partages externes', text: 'Collecte automatique des accès SharePoint ouverts à l\'extérieur du groupe.' },
  { icon: 'i-lucide-user-check', title: 'Validation par les managers', text: 'Chaque accès est confirmé ou arrêté par la bonne personne, avec un commentaire.' },
  { icon: 'i-lucide-shield-check', title: 'Remédiation tracée', text: 'Les retraits sont suivis par l\'IT et tout est historisé.' }
]
</script>

<template>
  <div class="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
    <!-- Panneau de présentation -->
    <section class="relative hidden overflow-hidden bg-neutral-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div class="pointer-events-none absolute -right-32 -top-32 size-[28rem] rounded-full bg-primary/20 blur-3xl" />
      <div class="pointer-events-none absolute -bottom-40 -left-24 size-[26rem] rounded-full bg-sky-500/10 blur-3xl" />

      <img src="/logo-fimavi.png" alt="Groupe Fimavi" class="relative h-12 w-auto self-start rounded-md">

      <div class="relative max-w-lg space-y-8">
        <div class="space-y-3">
          <h1 class="text-6xl font-bold leading-tight tracking-tight">Contrôles <span class="text-primary">IT</span><br>du groupe</h1>
          <p class="text-lg text-neutral-300">Revue des accès externes, validation et remédiation, au même endroit.</p>
        </div>
        <ul class="space-y-5">
          <li v-for="f in features" :key="f.title" class="flex gap-4">
            <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
              <UIcon :name="f.icon" class="size-5 text-primary" />
            </span>
            <div>
              <p class="font-semibold">{{ f.title }}</p>
              <p class="text-sm text-neutral-400">{{ f.text }}</p>
            </div>
          </li>
        </ul>
      </div>

      <p class="relative text-xs text-neutral-500">© Groupe Fimavi — Service informatique</p>
    </section>

    <!-- Connexion -->
    <section class="flex flex-col bg-default">
      <div class="p-6 lg:hidden">
        <img src="/logo-fimavi.png" alt="Groupe Fimavi" class="h-10 w-auto rounded-md">
      </div>
      <div class="flex flex-1 items-center justify-center px-6 pb-12 lg:p-12">
        <div class="w-full max-w-sm space-y-8">
          <div class="space-y-2">
            <!-- Sur mobile, le panneau de gauche (titre) est masqué : le titre est repris ici. -->
            <h1 class="text-3xl font-bold tracking-tight lg:hidden">Contrôles <span class="text-primary">IT</span> du groupe</h1>
            <p class="text-lg text-muted">Utilisez votre compte professionnel Microsoft du groupe.</p>
          </div>

          <UAlert v-if="hasError" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="errorText" />

          <a
            href="/auth/microsoft"
            data-testid="login-microsoft"
            class="flex h-12 w-full items-center justify-center gap-3 rounded-md border border-[#8c8c8c] bg-white px-4 text-[15px] font-semibold text-[#5e5e5e] shadow-sm transition hover:bg-neutral-50 hover:shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-neutral-700 dark:bg-[#2f2f2f] dark:text-white dark:hover:bg-[#3a3a3a]"
          >
            <MicrosoftLogo class="size-5" />
            Se connecter avec Microsoft
          </a>

          <div class="flex items-start gap-3 rounded-lg bg-elevated p-4 text-sm text-muted">
            <UIcon name="i-lucide-lock" class="mt-0.5 size-4 shrink-0" />
            <p>Connexion sécurisée par Microsoft Entra ID. Vos vérifications sont visibles par vous seul ; l'administration est réservée à l'équipe IT.</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
