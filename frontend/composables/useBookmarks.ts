// composables/useBookmarks.ts
import type { Bookmark } from '~/types/api'
import { queueMutation } from '~/utils/offline-queue'

export function useBookmarks(readId: Ref<number>) {
  const { isOnline } = useOffline()

  const { data: bookmarks, status, refresh } = useFetch<Bookmark[]>(
    () => `/api/reads/${readId.value}/bookmarks`,
    { default: () => [] },
  )

  async function addBookmark(segmentIndex: number, wordOffset: number = 0, note?: string) {
    const url = `/api/reads/${readId.value}/bookmarks`
    const body = { segment_index: segmentIndex, word_offset: wordOffset, note }

    if (isOnline.value) {
      await $fetch(url, { method: 'POST', body })
      await refresh()
    } else {
      // Optimistic local update
      const optimistic: Bookmark = {
        id: -Date.now(), // temporary negative id
        read_id: readId.value,
        segment_index: segmentIndex,
        word_offset: wordOffset,
        note: note ?? null,
        created_at: new Date().toISOString(),
      }
      bookmarks.value = [...bookmarks.value, optimistic]
      await queueMutation({ url, method: 'POST', body })
    }
  }

  async function updateBookmark(id: number, note: string) {
    const url = `/api/bookmarks/${id}`
    const body = { note }

    if (isOnline.value) {
      await $fetch(url, { method: 'PATCH', body })
      await refresh()
    } else {
      // Optimistic local update
      bookmarks.value = bookmarks.value.map((b) =>
        b.id === id ? { ...b, note } : b,
      )
      await queueMutation({ url, method: 'PATCH', body })
    }
  }

  async function deleteBookmark(id: number) {
    const url = `/api/bookmarks/${id}`

    if (isOnline.value) {
      await $fetch(url, { method: 'DELETE' })
      await refresh()
    } else {
      // Optimistic local update
      bookmarks.value = bookmarks.value.filter((b) => b.id !== id)
      await queueMutation({ url, method: 'DELETE' })
    }
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
