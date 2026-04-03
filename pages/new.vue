<template>
  <div class="max-w-2xl mx-auto flex flex-col gap-6">
    <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">New Read</h1>

    <!-- Input mode tabs -->
    <UTabs :items="inputModes" v-model="activeMode">
      <template #text>
        <div class="flex flex-col gap-4 mt-4">
          <UFormField label="Title">
            <UInput v-model="title" placeholder="Give this read a title..." class="w-full" />
          </UFormField>
          <UFormField label="Text">
            <TextInput v-model="content" />
          </UFormField>
        </div>
      </template>

      <template #url>
        <div class="flex flex-col gap-4 mt-4">
          <UFormField label="URL">
            <div class="flex gap-2">
              <UInput
                v-model="url"
                placeholder="https://example.com/article"
                class="flex-1"
                @keydown.enter="handleFetchUrl"
              />
              <UButton
                color="neutral"
                variant="outline"
                :loading="fetching"
                :disabled="!url.trim()"
                @click="handleFetchUrl"
              >
                Fetch
              </UButton>
            </div>
          </UFormField>

          <UAlert
            v-if="fetchError"
            color="error"
            :title="fetchError"
            icon="i-lucide-alert-circle"
          />

          <template v-if="content">
            <UFormField label="Title">
              <UInput v-model="title" placeholder="Article title..." class="w-full" />
            </UFormField>
            <UFormField label="Extracted Text">
              <TextInput v-model="content" />
            </UFormField>
          </template>
        </div>
      </template>
    </UTabs>

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
const url = ref('')
const fetching = ref(false)
const fetchError = ref('')
const creating = ref(false)
const activeMode = ref('text')

const inputModes = [
  { label: 'Text', slot: 'text' as const, value: 'text' },
  { label: 'From URL', slot: 'url' as const, value: 'url' },
]

const { createRead } = useLibrary()
const { selectedVoice } = useVoices()
const toast = useToast()

const canCreate = computed(() => content.value.trim().length > 0 && selectedVoice.value)

async function handleFetchUrl() {
  if (!url.value.trim()) return
  fetching.value = true
  fetchError.value = ''
  content.value = ''
  title.value = ''

  try {
    const article = await extractArticle(url.value.trim())
    title.value = article.title
    content.value = article.content
  } catch (e: any) {
    fetchError.value = e.message || 'Failed to extract content'
  } finally {
    fetching.value = false
  }
}

async function handleCreate() {
  if (!canCreate.value) return
  creating.value = true
  try {
    const readTitle = title.value.trim() || content.value.slice(0, 50).trim() + '...'
    const type = activeMode.value === 'url' ? 'url' as const : 'text' as const
    const sourceUrl = activeMode.value === 'url' ? url.value.trim() : undefined
    const id = await createRead(readTitle, content.value.trim(), type, sourceUrl)
    toast.add({ title: 'Read created', color: 'success' })
    await navigateTo(`/read/${id}`)
  } catch (e: any) {
    toast.add({ title: 'Failed to create read', description: e.message, color: 'error' })
  } finally {
    creating.value = false
  }
}
</script>
