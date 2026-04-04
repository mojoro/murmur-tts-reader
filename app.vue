<script setup lang="ts">
// Initialize background sync for offline support
if (import.meta.client) {
  const { startPeriodicSync } = useBackgroundSync()
  startPeriodicSync()
}
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
