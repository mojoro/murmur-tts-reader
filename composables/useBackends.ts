import type { Backend } from '~/types/api'

export function useBackends() {
  const { data: backends, status, refresh } = useFetch<Backend[]>('/api/backends', {
    default: () => [],
  })

  const activeBackend = computed(() => backends.value.find((b) => b.status === 'running'))

  let eventSource: EventSource | null = null

  function openSSE() {
    if (!import.meta.client || eventSource) return
    eventSource = new EventSource('/api/backends/events')
    eventSource.addEventListener('backend:status', () => refresh())
    eventSource.onerror = () => {
      closeSSE()
    }
  }

  function closeSSE() {
    eventSource?.close()
    eventSource = null
  }

  function onVisibilityChange() {
    if (document.hidden) {
      closeSSE()
    } else {
      refresh()
      openSSE()
    }
  }

  async function selectBackend(name: string) {
    await $fetch('/api/backends/select', { method: 'POST', body: { name } })
    await refresh()
  }

  async function installBackend(name: string) {
    await $fetch('/api/backends/install', { method: 'POST', body: { name } })
  }

  async function uninstallBackend(name: string) {
    await $fetch(`/api/backends/${name}`, { method: 'DELETE' })
    await refresh()
  }

  onMounted(() => {
    openSSE()
    document.addEventListener('visibilitychange', onVisibilityChange)
  })
  onUnmounted(() => {
    closeSSE()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return {
    backends,
    activeBackend,
    loading: computed(() => status.value === 'pending'),
    refresh,
    selectBackend,
    installBackend,
    uninstallBackend,
  }
}
