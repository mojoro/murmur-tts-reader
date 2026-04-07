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

      <template #file>
        <div class="flex flex-col gap-4 mt-4">
          <UFormField label="Document">
            <div
              class="flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed rounded-lg transition-colors cursor-pointer"
              :class="isDragging ? 'border-primary-500 bg-primary-500/5' : 'border-neutral-300 dark:border-neutral-700'"
              @click="fileInputRef?.click()"
              @dragover.prevent="isDragging = true"
              @dragleave="isDragging = false"
              @drop.prevent="handleFileDrop"
            >
              <UIcon name="i-lucide-file-text" class="size-8 text-neutral-400" />
              <p class="text-sm text-neutral-500">
                {{ selectedFile ? selectedFile.name : 'Drop a file here or click to browse' }}
              </p>
              <p class="text-xs text-neutral-400">PDF, EPUB, DOCX, TXT, Markdown, or HTML</p>
              <input
                ref="fileInputRef"
                type="file"
                accept=".pdf,.epub,.docx,.txt,.md,.html,.htm"
                class="hidden"
                @change="handleFileSelect"
              />
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
              <UInput v-model="title" placeholder="Document title..." class="w-full" />
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

const selectedFile = ref<File | null>(null)
const isDragging = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
const thumbnailUrl = ref<string>()
const thumbnailBlob = ref<Blob>()

const inputModes = [
  { label: 'Text', slot: 'text' as const, value: 'text' },
  { label: 'From URL', slot: 'url' as const, value: 'url' },
  { label: 'File', slot: 'file' as const, value: 'file' },
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
  thumbnailUrl.value = undefined
  thumbnailBlob.value = undefined
  try {
    const article = await extractArticle(url.value.trim())
    title.value = article.title
    content.value = article.content
    thumbnailUrl.value = article.thumbnailUrl
  } catch (e: any) {
    fetchError.value = e.message || 'Failed to extract content'
  } finally {
    fetching.value = false
  }
}

async function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.[0]) await processFile(input.files[0])
}

async function handleFileDrop(e: DragEvent) {
  isDragging.value = false
  const file = e.dataTransfer?.files[0]
  if (file) await processFile(file)
}

async function processFile(file: File) {
  selectedFile.value = file
  fetching.value = true
  fetchError.value = ''
  content.value = ''
  title.value = ''
  thumbnailUrl.value = undefined
  thumbnailBlob.value = undefined
  try {
    const parsed = await parseDocument(file)
    title.value = parsed.title
    content.value = parsed.content
    thumbnailBlob.value = parsed.thumbnail
  } catch (e: any) {
    fetchError.value = e.message || 'Failed to parse document'
  } finally {
    fetching.value = false
  }
}

async function uploadThumbnail(readId: number, blob?: Blob, url?: string) {
  if (blob) {
    const form = new FormData()
    form.append('file', blob, 'thumbnail.jpg')
    await $fetch(`/api/reads/${readId}/thumbnail`, { method: 'POST', body: form })
  } else if (url) {
    await $fetch(`/api/reads/${readId}/thumbnail`, { method: 'POST', body: { url } })
  }
}

async function handleCreate() {
  if (!canCreate.value) return
  creating.value = true
  try {
    const readTitle = title.value.trim() || content.value.slice(0, 50).trim() + '...'
    const typeMap = { text: 'text', url: 'url', file: 'file' } as const
    const type = typeMap[activeMode.value as keyof typeof typeMap] ?? 'text'
    const result = await createRead({
      title: readTitle,
      content: content.value.trim(),
      type,
      source_url: activeMode.value === 'url' ? url.value.trim() : undefined,
      file_name: activeMode.value === 'file' ? selectedFile.value?.name : undefined,
    })

    // Upload thumbnail before navigating (navigation cancels in-flight requests)
    if (thumbnailBlob.value || thumbnailUrl.value) {
      await uploadThumbnail(result.id, thumbnailBlob.value, thumbnailUrl.value).catch(() => {})
    }

    toast.add({ title: 'Read created', color: 'success' })
    await navigateTo(`/read/${result.id}?voice=${encodeURIComponent(selectedVoice.value)}`)
  } catch (e: any) {
    toast.add({ title: 'Failed to create read', description: e.message, color: 'error' })
  } finally {
    creating.value = false
  }
}
</script>
