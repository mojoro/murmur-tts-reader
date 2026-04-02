<template>
  <div class="max-w-2xl mx-auto p-8 flex flex-col gap-4">
    <h1 class="text-xl font-bold">pocket-tts</h1>

    <textarea
      v-model="text"
      class="w-full h-64 bg-[#111] border border-gray-700 rounded p-3 text-sm resize-none focus:outline-none focus:border-gray-500"
      placeholder="Paste text here..."
    />

    <button
      :disabled="loading || !text.trim()"
      class="px-4 py-2 bg-white text-black rounded font-semibold disabled:opacity-40 hover:bg-gray-200 transition-colors"
      @click="generate"
    >
      {{ loading ? 'Generating…' : 'Read aloud' }}
    </button>

    <audio v-if="audioUrl" :src="audioUrl" controls autoplay class="w-full" />

    <p v-if="error" class="text-red-400 text-sm">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
const { settings } = useSettings()
const text = ref('')
const audioUrl = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

async function generate() {
  loading.value = true
  error.value = null
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = null

  try {
    const res = await fetch(`${settings.value.ttsServerUrl}/tts/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.value, voice: 'alba' }),
    })
    if (!res.ok) throw new Error(`Server error ${res.status}`)
    const blob = await res.blob()
    audioUrl.value = URL.createObjectURL(blob)
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>
