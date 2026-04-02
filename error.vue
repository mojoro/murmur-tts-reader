<template>
  <div class="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-950 p-4">
    <div class="text-center flex flex-col items-center gap-4 max-w-md">
      <div class="size-16 rounded-full bg-red-500/10 flex items-center justify-center">
        <UIcon name="i-lucide-alert-triangle" class="size-8 text-red-500" />
      </div>
      <h1 class="text-4xl font-bold text-neutral-900 dark:text-neutral-50">
        {{ error?.statusCode || 500 }}
      </h1>
      <p class="text-lg text-neutral-600 dark:text-neutral-400">
        {{ error?.statusMessage || 'Something went wrong' }}
      </p>
      <p v-if="error?.message && error.message !== error.statusMessage" class="text-sm text-neutral-500">
        {{ error.message }}
      </p>
      <UButton
        color="primary"
        icon="i-lucide-home"
        class="mt-4"
        @click="handleError"
      >
        Go Home
      </UButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { NuxtError } from '#app'

defineProps<{
  error: NuxtError
}>()

function handleError() {
  clearError({ redirect: '/' })
}
</script>
