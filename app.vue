<script setup lang="ts">
// Initialize background sync for offline support
if (import.meta.client) {
  const { isOnline } = useOffline()
  const { startPeriodicSync, syncAll } = useBackgroundSync()
  startPeriodicSync()

  // Pull fresh data immediately on reconnect (after queue drains)
  watch(isOnline, (online) => {
    if (online) syncAll()
  })
}
</script>

<template>
  <UApp>
    <VitePwaManifest />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
