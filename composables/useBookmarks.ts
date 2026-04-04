import type { Bookmark } from '~/types/api'

export function useBookmarks(readId: Ref<number>) {
  const { data: bookmarks, status, refresh } = useFetch<Bookmark[]>(
    () => `/api/reads/${readId.value}/bookmarks`,
    { default: () => [] },
  )

  async function addBookmark(segmentIndex: number, wordOffset: number = 0, note?: string) {
    await $fetch(`/api/reads/${readId.value}/bookmarks`, {
      method: 'POST',
      body: { segment_index: segmentIndex, word_offset: wordOffset, note },
    })
    await refresh()
  }

  async function updateBookmark(id: number, note: string) {
    await $fetch(`/api/bookmarks/${id}`, {
      method: 'PATCH',
      body: { note },
    })
    await refresh()
  }

  async function deleteBookmark(id: number) {
    await $fetch(`/api/bookmarks/${id}`, { method: 'DELETE' })
    await refresh()
  }

  return {
    bookmarks,
    loading: computed(() => status.value === 'pending'),
    refresh,
    addBookmark,
    updateBookmark,
    deleteBookmark,
  }
}
