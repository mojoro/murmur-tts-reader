<template>
  <UModal v-model:open="open">
    <template #content>
      <div class="p-6 flex flex-col gap-4">
        <h3 class="text-lg font-semibold text-neutral-900 dark:text-neutral-50">Clone Voice</h3>
        <p class="text-sm text-neutral-500">Upload a WAV file or record your voice to clone.</p>

        <UFormField label="Voice Name">
          <UInput v-model="name" placeholder="e.g. My Voice" class="w-full" />
        </UFormField>

        <!-- Source tabs: Upload or Record -->
        <UTabs :items="sourceTabs" v-model="activeTab">
          <template #upload>
            <div
              class="flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed rounded-lg transition-colors cursor-pointer mt-3"
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
          </template>

          <template #record>
            <div class="flex flex-col items-center gap-4 p-6 mt-3">
              <!-- Recording status -->
              <div class="flex items-center gap-2 text-sm text-neutral-500">
                <span
                  v-if="recording"
                  class="size-3 rounded-full bg-red-500 animate-pulse"
                />
                <span v-if="recording">Recording... {{ recordingTime }}s</span>
                <span v-else-if="recordedBlob">Recording ready ({{ recordingDuration }}s)</span>
                <span v-else>Click to start recording</span>
              </div>

              <!-- Record button -->
              <UButton
                :icon="recording ? 'i-lucide-square' : 'i-lucide-mic'"
                :color="recording ? 'error' : 'primary'"
                size="xl"
                class="rounded-full"
                @click="toggleRecording"
              >
                {{ recording ? 'Stop' : recordedBlob ? 'Re-record' : 'Record' }}
              </UButton>

              <!-- Playback preview -->
              <audio
                v-if="recordedUrl"
                :src="recordedUrl"
                controls
                class="w-full max-w-xs"
              />
            </div>
          </template>
        </UTabs>

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
const activeTab = ref('upload')

// Recording state
const recording = ref(false)
const recordedBlob = ref<Blob | null>(null)
const recordedUrl = ref<string | null>(null)
const recordingTime = ref(0)
const recordingDuration = ref(0)
let mediaRecorder: MediaRecorder | null = null
let recordingInterval: ReturnType<typeof setInterval> | undefined

const sourceTabs = [
  { label: 'Upload', slot: 'upload' as const, value: 'upload' },
  { label: 'Record', slot: 'record' as const, value: 'record' },
]

const audioSource = computed<File | null>(() => {
  if (activeTab.value === 'upload') return file.value
  if (activeTab.value === 'record' && recordedBlob.value) {
    return new File([recordedBlob.value], 'recording.wav', { type: 'audio/wav' })
  }
  return null
})

const canClone = computed(() => name.value.trim() && audioSource.value)

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

async function toggleRecording() {
  if (recording.value) {
    stopRecording()
  } else {
    await startRecording()
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const chunks: Blob[] = []

    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      const webmBlob = new Blob(chunks, { type: 'audio/webm' })
      recordedBlob.value = await convertToWav(webmBlob)
      if (recordedUrl.value) URL.revokeObjectURL(recordedUrl.value)
      recordedUrl.value = URL.createObjectURL(recordedBlob.value)
      recordingDuration.value = recordingTime.value
    }

    // Clear previous recording
    if (recordedUrl.value) {
      URL.revokeObjectURL(recordedUrl.value)
      recordedUrl.value = null
    }
    recordedBlob.value = null
    recordingTime.value = 0

    mediaRecorder.start()
    recording.value = true
    recordingInterval = setInterval(() => {
      recordingTime.value++
    }, 1000)
  } catch (e: any) {
    toast.add({ title: 'Microphone access denied', description: e.message, color: 'error' })
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
  recording.value = false
  if (recordingInterval) {
    clearInterval(recordingInterval)
    recordingInterval = undefined
  }
}

async function convertToWav(webmBlob: Blob): Promise<Blob> {
  const arrayBuffer = await webmBlob.arrayBuffer()
  const audioCtx = new AudioContext({ sampleRate: 24000 })
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
  audioCtx.close()

  // Encode as 16-bit PCM WAV
  const numChannels = 1
  const sampleRate = audioBuffer.sampleRate
  const channelData = audioBuffer.getChannelData(0)
  const dataLength = channelData.length * 2
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * 2, true)
  view.setUint16(32, numChannels * 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataLength, true)

  // PCM samples
  let offset = 44
  for (let i = 0; i < channelData.length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

async function handleClone() {
  if (!canClone.value || !audioSource.value) return
  cloning.value = true
  try {
    await cloneVoice(
      settings.value.ttsServerUrl,
      name.value.trim(),
      audioSource.value,
      promptText.value.trim() || undefined,
    )
    await syncVoices()
    toast.add({ title: 'Voice cloned', description: `"${name.value}" is now available`, color: 'success' })
    resetAndClose()
  } catch (e: any) {
    toast.add({ title: 'Clone failed', description: e.message, color: 'error' })
  } finally {
    cloning.value = false
  }
}

function resetAndClose() {
  open.value = false
  name.value = ''
  file.value = null
  promptText.value = ''
  activeTab.value = 'upload'
  if (recordedUrl.value) {
    URL.revokeObjectURL(recordedUrl.value)
    recordedUrl.value = null
  }
  recordedBlob.value = null
  recordingTime.value = 0
  recordingDuration.value = 0
}

// Cleanup on unmount
onUnmounted(() => {
  stopRecording()
  if (recordedUrl.value) URL.revokeObjectURL(recordedUrl.value)
})
</script>
