<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { loggedIn, user, clear } = useUserSession()

const links = computed<NavigationMenuItem[]>(() => [
  { label: 'Mes vérifications', icon: 'i-lucide-list-checks', to: '/' },
  ...(user.value?.isAdmin
    ? [
        { label: 'Administration', icon: 'i-lucide-shield', to: '/admin', exact: true },
        { label: 'Historique', icon: 'i-lucide-history', to: '/admin/history' },
        { label: 'Paramètres', icon: 'i-lucide-settings', to: '/admin/settings' }
      ]
    : [])
])

async function logout() {
  await $fetch('/auth/logout', { method: 'POST' })
  await clear()
  await navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <header v-if="loggedIn" class="border-b border-default">
      <UContainer class="flex max-w-[1920px] items-center justify-between gap-4 py-3">
        <NuxtLink to="/" class="flex shrink-0 items-center gap-3" aria-label="Contrôles IT — accueil">
          <img src="/logo-fimavi.png" alt="Groupe Fimavi" class="h-9 w-auto rounded">
          <span class="whitespace-nowrap text-lg font-bold tracking-tight">Contrôles <span class="text-primary">IT</span></span>
        </NuxtLink>
        <UNavigationMenu :items="links" class="flex-1" />
        <div class="flex items-center gap-2">
          <span class="text-sm text-muted">{{ user?.name }}</span>
          <UButton icon="i-lucide-log-out" color="neutral" variant="ghost" aria-label="Se déconnecter" @click="logout" />
        </div>
      </UContainer>
    </header>
    <UContainer class="max-w-[1920px] py-6">
      <slot />
    </UContainer>
  </div>
</template>
