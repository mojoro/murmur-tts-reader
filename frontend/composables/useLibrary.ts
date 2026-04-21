import type { ReadSummary, ReadDetail } from '~/types/api'

export function useLibrary() {
  const { data: reads, status, refresh } = useFetch<ReadSummary[]>('/api/reads', {
    default: () => [],
  })

  async function createRead(body: {
    title: string
    content: string
    type: string
    source_url?: string
    file_name?: string
  }): Promise<ReadDetail> {
    const result = await $fetch<ReadDetail>('/api/reads', {
      method: 'POST',
      body,
    })
    await refresh()
    return result
  }

  async function deleteRead(id: number) {
    await $fetch(`/api/reads/${id}`, { method: 'DELETE' })
    await refresh()
  }

  return {
    reads,
    loading: computed(() => status.value === 'pending'),
    refresh,
    createRead,
    deleteRead,
  }
}
