<template>
  <div class="max-w-2xl mx-auto flex flex-col gap-6">
    <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">New Read</h1>

    <UFormField label="Title">
      <UInput v-model="title" placeholder="Give this read a title..." class="w-full" />
    </UFormField>

    <UFormField label="Text">
      <TextInput v-model="content" />
    </UFormField>

    <UFormField label="Voice">
      <VoiceSelector />
    </UFormField>

    <div class="flex gap-3">
      <UButton
        color="primary"
        :disabled="!canCreate"
        :loading="creating"
        @click="handleCreate"
      >
        Create Read
      </UButton>
      <UButton
        variant="ghost"
        color="neutral"
        to="/"
      >
        Cancel
      </UButton>
    </div>
  </div>
</template>

<script setup lang="ts">
const title = ref('')
const content = ref('')
const creating = ref(false)

const { createRead } = useLibrary()
const { selectedVoice } = useVoices()

const canCreate = computed(() => content.value.trim().length > 0 && selectedVoice.value)

async function handleCreate() {
  if (!canCreate.value) return
  creating.value = true
  try {
    const readTitle = title.value.trim() || content.value.slice(0, 50).trim() + '...'
    const id = await createRead(readTitle, content.value.trim())
    await navigateTo(`/read/${id}`)
  } finally {
    creating.value = false
  }
}
</script>
