import { eq, and } from 'drizzle-orm'
import { bookmarks } from '~/shared/schema'
import type { Bookmark } from '~/types/db'

export function useBookmarks(readId: Ref<number>) {
  const { getDb, persist } = useDatabase()

  const bookmarkList = ref<Bookmark[]>([])
  const loading = ref(false)

  async function fetchBookmarks() {
    loading.value = true
    try {
      const db = await getDb()
      bookmarkList.value = await db
        .select()
        .from(bookmarks)
        .where(eq(bookmarks.readId, readId.value))
        .orderBy(bookmarks.segmentIndex)
    } finally {
      loading.value = false
    }
  }

  async function addBookmark(segmentIndex: number, wordOffset: number = 0, note?: string) {
    const db = await getDb()
    await db.insert(bookmarks).values({
      readId: readId.value,
      segmentIndex,
      wordOffset,
      note: note ?? null,
    })
    await persist()
    await fetchBookmarks()
  }

  async function updateBookmark(id: number, note: string) {
    const db = await getDb()
    await db.update(bookmarks).set({ note }).where(eq(bookmarks.id, id))
    await persist()
    await fetchBookmarks()
  }

  async function deleteBookmark(id: number) {
    const db = await getDb()
    await db.delete(bookmarks).where(eq(bookmarks.id, id))
    await persist()
    await fetchBookmarks()
  }

  return {
    bookmarks: readonly(bookmarkList),
    loading: readonly(loading),
    fetchBookmarks,
    addBookmark,
    updateBookmark,
    deleteBookmark,
  }
}
