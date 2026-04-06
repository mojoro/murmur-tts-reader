import type { Job } from '~/types/api'

interface GenerationOptions {
  onSegmentDone?: (segmentIndex: number) => void
}

export function useGeneration(readId: Ref<number>, options: GenerationOptions = {}) {
  const job = ref<Job | null>(null)
  const generating = computed(() =>
    job.value?.status === 'pending' || job.value?.status === 'running',
  )
  const progress = computed(() => job.value?.progress ?? 0)
  const total = computed(() => job.value?.total ?? 0)
  const error = computed(() => job.value?.error ?? null)

  let eventSource: EventSource | null = null

  async function generate(voice: string, language?: string, regenerate?: boolean) {
    const result = await $fetch<Job>(`/api/reads/${readId.value}/generate`, {
      method: 'POST',
      body: { voice, language, regenerate },
    })
    job.value = result
    connectSSE()
  }

  function connectSSE() {
    if (!import.meta.client || !job.value) return
    disconnectSSE()

    eventSource = new EventSource('/api/queue/events')

    eventSource.addEventListener('job:progress', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      if (data.jobId === job.value?.id) {
        job.value = { ...job.value!, progress: data.segment, status: 'running' }
        options.onSegmentDone?.(data.segment - 1)
      }
    })

    eventSource.addEventListener('job:completed', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      if (data.jobId === job.value?.id) {
        job.value = { ...job.value!, status: 'done', progress: job.value!.total }
        disconnectSSE()
      }
    })

    eventSource.addEventListener('job:failed', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      if (data.jobId === job.value?.id) {
        job.value = { ...job.value!, status: 'failed', error: data.error }
        disconnectSSE()
      }
    })

    eventSource.addEventListener('job:cancelled', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      if (data.jobId === job.value?.id) {
        job.value = { ...job.value!, status: 'cancelled' }
        disconnectSSE()
      }
    })
  }

  function disconnectSSE() {
    eventSource?.close()
    eventSource = null
  }

  async function cancel() {
    if (!job.value) return
    await $fetch(`/api/queue/${job.value.id}`, { method: 'DELETE' })
    job.value = null
    disconnectSSE()
  }

  onUnmounted(disconnectSSE)

  return {
    job: readonly(job),
    generating,
    progress,
    total,
    error,
    generate,
    cancel,
  }
}
