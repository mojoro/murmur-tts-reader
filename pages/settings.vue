<template>
  <div class="max-w-2xl mx-auto flex flex-col gap-8">
    <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Settings</h1>

    <section class="flex flex-col gap-4">
      <h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">TTS Engine</h2>
      <p class="text-sm text-neutral-500">Select which TTS engine to use for audio generation.</p>

      <div v-if="loading" class="flex flex-col gap-3">
        <USkeleton v-for="i in 3" :key="i" class="h-24 w-full rounded-lg" />
      </div>

      <EngineSelector
        v-else
        :backends="backends"
        @select="handleSelect"
        @install="handleInstall"
      />
    </section>

    <USeparator />

    <section class="flex flex-col gap-4">
      <h2 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Storage & Sync</h2>
      <p class="text-sm text-neutral-500">
        Control offline data caching. When enabled, all reads and audio are downloaded for offline use.
      </p>

      <div class="flex items-center justify-between p-4 rounded-lg bg-neutral-50 dark:bg-neutral-900">
        <div>
          <p class="text-sm font-medium text-neutral-900 dark:text-neutral-50">Auto-sync for offline</p>
          <p class="text-xs text-neutral-500 mt-0.5">Download reads and audio in the background</p>
        </div>
        <USwitch
          :model-value="autoSyncEnabled"
          @update:model-value="setAutoSync"
        />
      </div>

      <div class="flex items-center justify-between p-4 rounded-lg bg-neutral-50 dark:bg-neutral-900">
        <div>
          <p class="text-sm font-medium text-neutral-900 dark:text-neutral-50">Storage used</p>
          <p class="text-xs text-neutral-500 mt-0.5">{{ storageDisplay }}</p>
        </div>
        <UButton
          color="error"
          variant="outline"
          size="sm"
          icon="i-lucide-trash-2"
          :loading="clearing"
          @click="handleClearCache"
        >
          Clear cache
        </UButton>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { clearMutations } from '~/utils/offline-queue'

const { backends, loading, selectBackend, installBackend } = useBackends()
const { autoSyncEnabled, setAutoSync } = useBackgroundSync()
const toast = useToast()

const storageDisplay = ref('Calculating...')
const clearing = ref(false)

async function estimateStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    storageDisplay.value = 'Not available'
    return
  }
  const { usage, quota } = await navigator.storage.estimate()
  const usedMB = ((usage ?? 0) / (1024 * 1024)).toFixed(1)
  const quotaMB = ((quota ?? 0) / (1024 * 1024)).toFixed(0)
  storageDisplay.value = `${usedMB} MB used of ${quotaMB} MB available`
}

async function handleClearCache() {
  clearing.value = true
  try {
    // Clear all workbox caches
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames.map((name) => caches.delete(name)))

    // Clear offline mutation queue
    await clearMutations()

    await estimateStorage()
    toast.add({ title: 'Cache cleared', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Failed to clear cache', description: e.message, color: 'error' })
  } finally {
    clearing.value = false
  }
}

async function handleSelect(name: string) {
  try {
    await selectBackend(name)
    toast.add({ title: `Switched to ${name}`, color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Switch failed', description: e.message, color: 'error' })
  }
}

async function handleInstall(name: string) {
  try {
    await installBackend(name)
    toast.add({ title: `Installing ${name}...`, color: 'info' })
  } catch (e: any) {
    toast.add({ title: 'Install failed', description: e.message, color: 'error' })
  }
}

onMounted(estimateStorage)
</script>
