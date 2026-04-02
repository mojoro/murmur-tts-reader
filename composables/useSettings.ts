const STORAGE_KEY = 'pocket-tts-settings'

interface Settings {
  ttsServerUrl: string
  alignServerUrl: string
}

const defaults: Settings = {
  ttsServerUrl: 'http://localhost:8000',
  alignServerUrl: 'http://localhost:8001',
}

function load(): Settings {
  if (!import.meta.client) return { ...defaults }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaults }
    return { ...defaults, ...JSON.parse(raw) }
  } catch {
    return { ...defaults }
  }
}

function save(settings: Settings): void {
  if (!import.meta.client) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

const settings = ref<Settings>(load())

export function useSettings() {
  function update(partial: Partial<Settings>) {
    settings.value = { ...settings.value, ...partial }
    save(settings.value)
  }

  function reset() {
    settings.value = { ...defaults }
    save(settings.value)
  }

  return {
    settings: readonly(settings),
    update,
    reset,
  }
}
