<template>
  <UModal v-model:open="open">
    <template #content>
      <div class="p-6 flex flex-col gap-4">
        <h3 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Clone Voice</h3>
        <p class="text-sm text-neutral-500">Upload a WAV file of the voice you want to clone.</p>

        <UFormField label="Voice Name">
          <UInput v-model="name" placeholder="e.g. My Voice" class="w-full" />
        </UFormField>

        <UFormField label="Reference Audio (WAV)">
          <div
            ref="dropzoneRef"
            class="flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed rounded-lg transition-colors cursor-pointer"
            :class="isDragging ? 'border-primary-500 bg-primary-500/5' : 'border-neutral-300 dark:border-neutral-700'"
            @click="openFileDialog"
            @dragover.prevent="isDragging = true"
            @dragleave="isDragging = false"
            @drop.prevent="handleDrop"
          >
            <UIcon name="i-lucide-upload" class="size-8 text-neutral-400" />
            <p class="text-sm text-neutral-500">
              {{ file ? file.name : 'Drop WAV file here or click to browse' }}
            </p>
            <input
              ref="fileInputRef"
              type="file"
              accept=".wav,audio/wav"
              class="hidden"
              @change="handleFileSelect"
            />
          </div>
        </UFormField>

        <UFormField label="Prompt Text (optional)">
          <UInput v-model="promptText" placeholder="Transcript of the reference audio..." class="w-full" />
          <template #description>
            Some TTS backends use this for better voice cloning accuracy.
          </template>
        </UFormField>

        <div class="flex justify-end gap-3 mt-2">
          <UButton variant="ghost" color="neutral" @click="open = false">Cancel</UButton>
          <UButton
            color="primary"
            :disabled="!canClone"
            :loading="cloning"
            @click="handleClone"
          >
            Clone Voice
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

const { settings } = useSettings()
const { syncVoices } = useVoices()
const toast = useToast()

const name = ref('')
const file = ref<File | null>(null)
const promptText = ref('')
const cloning = ref(false)
const isDragging = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

const canClone = computed(() => name.value.trim() && file.value)

function openFileDialog() {
  fileInputRef.value?.click()
}

function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.[0]) file.value = input.files[0]
}

function handleDrop(e: DragEvent) {
  isDragging.value = false
  const dropped = e.dataTransfer?.files[0]
  if (dropped && (dropped.type === 'audio/wav' || dropped.name.endsWith('.wav'))) {
    file.value = dropped
  }
}

async function handleClone() {
  if (!canClone.value || !file.value) return
  cloning.value = true
  try {
    await cloneVoice(
      settings.value.ttsServerUrl,
      name.value.trim(),
      file.value,
      promptText.value.trim() || undefined,
    )
    await syncVoices()
    toast.add({ title: 'Voice cloned', description: `"${name.value}" is now available`, color: 'success' })
    open.value = false
    name.value = ''
    file.value = null
    promptText.value = ''
  } catch (e: any) {
    toast.add({ title: 'Clone failed', description: e.message, color: 'error' })
  } finally {
    cloning.value = false
  }
}
</script>
