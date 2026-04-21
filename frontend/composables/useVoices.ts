import type { Voice } from '~/types/api'

export function useVoices() {
  const { data: voices, status, refresh } = useFetch<Voice[]>('/api/voices', {
    default: () => [],
  })

  const selectedVoice = useState<string>('selected-voice', () => '')

  function selectVoice(name: string) {
    selectedVoice.value = name
  }

  async function syncVoices() {
    await $fetch<Voice[]>('/api/voices/sync', { method: 'POST' })
    await refresh()
  }

  async function cloneVoice(name: string, file: File, promptText?: string) {
    const form = new FormData()
    form.append('name', name)
    form.append('file', file, `${name}.wav`)
    if (promptText) form.append('prompt_text', promptText)
    await $fetch('/api/voices/clone', { method: 'POST', body: form })
    await refresh()
  }

  watch(voices, (list) => {
    if (!selectedVoice.value && list.length > 0) {
      selectedVoice.value = list[0].name
    }
  }, { immediate: true })

  return {
    voices,
    selectedVoice: readonly(selectedVoice),
    pending: computed(() => status.value === 'pending'),
    refresh,
    syncVoices,
    cloneVoice,
    selectVoice,
  }
}
