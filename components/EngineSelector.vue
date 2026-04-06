<template>
  <div class="flex flex-col gap-3">
    <div
      v-for="backend in backends"
      :key="backend.name"
      class="flex items-center gap-4 p-4 rounded-lg border border-neutral-200 dark:border-neutral-800"
    >
      <span class="size-3 rounded-full shrink-0" :class="statusDotClass(backend.status)" />

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-medium text-neutral-900 dark:text-neutral-50">{{ backend.display_name }}</span>
          <UBadge v-if="backend.gpu" variant="subtle" color="warning" size="sm">GPU</UBadge>
        </div>
        <p class="text-sm text-neutral-500 mt-0.5">{{ backend.description }}</p>
        <p class="text-xs text-neutral-400 mt-0.5">{{ backend.size }}</p>
      </div>

      <div class="shrink-0 flex items-center gap-2">
        <template v-if="backend.status === 'running'">
          <UBadge color="success" variant="subtle">Active</UBadge>
        </template>
        <template v-else-if="backend.status === 'installed' || backend.status === 'stopped'">
          <UButton size="sm" variant="outline" @click="emit('select', backend.name)">
            Switch
          </UButton>
          <UButton
            size="sm"
            variant="ghost"
            color="error"
            icon="i-lucide-trash-2"
            @click="emit('uninstall', backend.name)"
          />
        </template>
        <template v-else-if="backend.status === 'available'">
          <UButton size="sm" variant="outline" @click="emit('install', backend.name)">
            Download
          </UButton>
        </template>
        <template v-else-if="backend.status === 'installing'">
          <UIcon name="i-lucide-loader-2" class="size-4 animate-spin text-sky-500" />
          <span class="text-xs text-sky-500">Installing...</span>
        </template>
        <template v-else-if="backend.status === 'unavailable'">
          <UBadge color="error" variant="subtle">Unavailable</UBadge>
          <UButton
            size="sm"
            variant="ghost"
            color="error"
            icon="i-lucide-trash-2"
            @click="emit('uninstall', backend.name)"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Backend, EngineStatus } from '~/types/api'

defineProps<{
  backends: Backend[]
}>()

const emit = defineEmits<{
  select: [name: string]
  install: [name: string]
  uninstall: [name: string]
}>()

function statusDotClass(status: EngineStatus) {
  switch (status) {
    case 'running': return 'bg-green-500'
    case 'installing': return 'bg-sky-500 animate-pulse'
    case 'installed':
    case 'stopped': return 'bg-yellow-500'
    case 'available': return 'bg-neutral-400'
    case 'unavailable': return 'bg-red-500'
    default: return 'bg-neutral-400'
  }
}
</script>
