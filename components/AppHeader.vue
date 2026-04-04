<template>
  <header class="flex items-center h-14 px-4 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
    <UButton
      icon="i-lucide-menu"
      variant="ghost"
      color="neutral"
      class="lg:hidden mr-2"
      @click="emit('toggleSidebar')"
    />
    <NuxtLink to="/" class="lg:hidden text-lg font-semibold text-neutral-900 dark:text-neutral-50">
      pocket-tts
    </NuxtLink>

    <div class="flex-1" />

    <!-- Health indicator -->
    <div class="flex items-center gap-2 mr-3">
      <span
        class="size-2 rounded-full"
        :class="health?.status === 'ok' ? 'bg-green-500' : 'bg-red-500'"
      />
      <span class="text-xs text-neutral-500 hidden sm:inline">
        {{ health?.active_engine ?? 'no engine' }}
      </span>
    </div>

    <!-- Color mode toggle -->
    <UButton
      :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
      variant="ghost"
      color="neutral"
      @click="toggleColorMode"
    />
  </header>
</template>

<script setup lang="ts">
import type { HealthResponse } from '~/types/api'

const emit = defineEmits<{
  toggleSidebar: []
}>()

const colorMode = useColorMode()

function toggleColorMode() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}

const health = ref<HealthResponse | null>(null)

async function checkHealth() {
  if (!import.meta.client) return
  try {
    health.value = await $fetch<HealthResponse>('/api/health')
  } catch {
    health.value = null
  }
}

let healthInterval: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  checkHealth()
  healthInterval = setInterval(checkHealth, 30_000)
})

onUnmounted(() => {
  if (healthInterval) clearInterval(healthInterval)
})
</script>
