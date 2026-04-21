import type { Job } from '~/types/api'

export function useQueue() {
  const { data: jobs, status, refresh } = useFetch<Job[]>('/api/queue', {
    default: () => [],
  })

  let eventSource: EventSource | null = null

  function openSSE() {
    if (!import.meta.client || eventSource) return
    eventSource = new EventSource('/api/queue/events')

    const events = ['job:queued', 'job:started', 'job:progress', 'job:completed', 'job:failed', 'job:cancelled']
    for (const event of events) {
      eventSource.addEventListener(event, () => refresh())
    }
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

  async function cancelJob(jobId: number) {
    await $fetch(`/api/queue/${jobId}`, { method: 'DELETE' })
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
    jobs,
    loading: computed(() => status.value === 'pending'),
    refresh,
    cancelJob,
  }
}
