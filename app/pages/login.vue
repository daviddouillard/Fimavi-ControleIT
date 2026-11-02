<script setup lang="ts">
const route = useRoute()
const hasError = computed(() => route.query.error !== undefined)
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
        title="La connexion a échoué. Réessayez ou contactez l'IT."
        class="mb-4"
      />

      <UButton to="/auth/microsoft" external block icon="i-lucide-log-in" data-testid="login-microsoft">
        Se connecter avec Microsoft
      </UButton>
    </UCard>
  </div>
</template>
