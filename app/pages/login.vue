<script setup lang="ts">
const route = useRoute()
const hasError = computed(() => route.query.error !== undefined)
const errorText = computed(() => route.query.error === 'domain'
  ? 'Votre compte n\'appartient pas à un domaine du groupe autorisé à utiliser ControleIT. Contactez l\'IT.'
  : 'La connexion a échoué. Réessayez ou contactez l\'IT.')
</script>

<template>
  <div class="flex min-h-[70vh] items-center justify-center">
    <UCard class="w-full max-w-sm">
      <template #header>
        <h1 class="text-lg font-semibold">ControleIT</h1>
        <p class="text-sm text-muted">Contrôles IT Fimavi</p>
      </template>

      <UAlert
        v-if="hasError"
        color="error"
        variant="subtle"
        :title="errorText"
        class="mb-4"
      />

      <UButton to="/auth/microsoft" external block icon="i-lucide-log-in" data-testid="login-microsoft">
        Se connecter avec Microsoft
      </UButton>
    </UCard>
  </div>
</template>
