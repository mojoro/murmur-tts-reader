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
  </div>
</template>

<script setup lang="ts">
const { backends, loading, selectBackend, installBackend } = useBackends()
const toast = useToast()

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
</script>
