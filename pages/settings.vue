<template>
  <div class="max-w-2xl mx-auto flex flex-col gap-6">
    <h1 class="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Settings</h1>

    <UFormField label="TTS Server URL">
      <UInput
        :model-value="settings.ttsServerUrl"
        placeholder="http://192.168.1.5:8000"
        class="w-full"
        @update:model-value="update({ ttsServerUrl: $event as string })"
      />
      <template #description>
        The address of your TTS backend (e.g. your Mac's local IP)
      </template>
    </UFormField>

    <UFormField label="Alignment Server URL">
      <UInput
        :model-value="settings.alignServerUrl"
        placeholder="http://192.168.1.5:8001"
        class="w-full"
        @update:model-value="update({ alignServerUrl: $event as string })"
      />
      <template #description>
        WhisperX alignment server for word-level highlighting
      </template>
    </UFormField>

    <div class="flex gap-3">
      <UButton
        color="neutral"
        variant="outline"
        @click="testConnection"
        :loading="testing"
      >
        Test Connection
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        @click="reset"
      >
        Reset to Defaults
      </UButton>
    </div>

    <UAlert
      v-if="testResult"
      :color="testResult.ok ? 'success' : 'error'"
      :title="testResult.ok ? 'Connected' : 'Connection Failed'"
      :description="testResult.message"
    />
  </div>
</template>

<script setup lang="ts">
const { settings, update, reset } = useSettings()
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)

async function testConnection() {
  testing.value = true
  testResult.value = null
  try {
    const res = await fetch(`${settings.value.ttsServerUrl}/health`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    testResult.value = {
      ok: true,
      message: `Backend: ${data.backend}, Model loaded: ${data.model_loaded}`,
    }
  } catch (e: any) {
    testResult.value = {
      ok: false,
      message: e.message || 'Could not reach TTS server',
    }
  } finally {
    testing.value = false
  }
}
</script>
