<template>
  <div class="max-w-3xl mx-auto flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Voices</h1>
      <div class="flex gap-2">
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="syncVoices"
        >
          Sync
        </UButton>
        <UButton
          color="primary"
          icon="i-lucide-plus"
          @click="cloneModalOpen = true"
        >
          Clone Voice
        </UButton>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="pending && voices.length === 0" class="flex flex-col gap-3">
      <USkeleton v-for="i in 4" :key="i" class="h-16 w-full rounded-lg" />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="voices.length === 0"
      class="flex flex-col items-center justify-center py-16 gap-4 text-neutral-500"
    >
      <UIcon name="i-lucide-mic-off" class="size-12" />
      <p class="text-lg">No voices found</p>
      <p class="text-sm">Sync voices from your TTS backend or clone a new one</p>
    </div>

    <!-- Voice sections -->
    <template v-else>
      <!-- Built-in voices -->
      <div v-if="builtinVoices.length > 0" class="flex flex-col gap-3">
        <h2 class="text-sm font-medium text-neutral-500 uppercase tracking-wider">Built-in</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UCard v-for="voice in builtinVoices" :key="voice.id">
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-mic" class="size-5 text-neutral-400" />
              <span class="font-medium text-neutral-900 dark:text-neutral-50">{{ voice.name }}</span>
              <UBadge variant="subtle" color="neutral" size="sm">builtin</UBadge>
            </div>
          </UCard>
        </div>
      </div>

      <USeparator v-if="builtinVoices.length > 0 && clonedVoices.length > 0" />

      <!-- Cloned voices -->
      <div v-if="clonedVoices.length > 0" class="flex flex-col gap-3">
        <h2 class="text-sm font-medium text-neutral-500 uppercase tracking-wider">Cloned</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UCard v-for="voice in clonedVoices" :key="voice.id">
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-user" class="size-5 text-primary-500" />
              <span class="font-medium text-neutral-900 dark:text-neutral-50">{{ voice.name }}</span>
              <UBadge variant="subtle" color="primary" size="sm">cloned</UBadge>
            </div>
          </UCard>
        </div>
      </div>
    </template>

    <!-- Clone modal -->
    <VoiceCloneModal v-model:open="cloneModalOpen" />
  </div>
</template>

<script setup lang="ts">
const { voices, pending, syncVoices, fetchVoicesFromDb } = useVoices()
const cloneModalOpen = ref(false)

const builtinVoices = computed(() => voices.value.filter((v) => v.type === 'builtin'))
const clonedVoices = computed(() => voices.value.filter((v) => v.type === 'cloned'))

onMounted(async () => {
  if (voices.value.length === 0) {
    try {
      await syncVoices()
    } catch {
      await fetchVoicesFromDb()
    }
  }
})
</script>
