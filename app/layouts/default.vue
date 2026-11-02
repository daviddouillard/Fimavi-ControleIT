<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { loggedIn, user, clear } = useUserSession()

const links = computed<NavigationMenuItem[]>(() => [
  { label: 'Mes vérifications', icon: 'i-lucide-list-checks', to: '/' },
  ...(user.value?.isAdmin
    ? [
        { label: 'Administration', icon: 'i-lucide-shield', to: '/admin', exact: true },
        { label: 'Historique', icon: 'i-lucide-history', to: '/admin/history' }
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
      <UContainer class="flex items-center justify-between gap-4 py-3">
        <NuxtLink to="/" class="font-semibold">ControleIT</NuxtLink>
        <UNavigationMenu :items="links" class="flex-1" />
        <div class="flex items-center gap-2">
          <span class="text-sm text-muted">{{ user?.name }}</span>
          <UButton icon="i-lucide-log-out" color="neutral" variant="ghost" aria-label="Se déconnecter" @click="logout" />
        </div>
      </UContainer>
    </header>
    <UContainer class="py-6">
      <slot />
    </UContainer>
  </div>
</template>
