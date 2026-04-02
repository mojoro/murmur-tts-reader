import { eq, desc } from 'drizzle-orm'
import { reads, audioSegments } from '~/shared/schema'
import type { Read, AudioSegment } from '~/types/db'

const libraryReads = ref<Read[]>([])
const loading = ref(false)

export function useLibrary() {
  const { getDb, persist } = useDatabase()
  const { deleteAudioForRead } = useAudioStorage()

  async function fetchReads() {
    loading.value = true
    try {
      const db = await getDb()
      libraryReads.value = await db.select().from(reads).orderBy(desc(reads.createdAt))
    } finally {
      loading.value = false
    }
  }

  async function getRead(id: number): Promise<{ read: Read; segments: AudioSegment[] } | null> {
    const db = await getDb()
    const [read] = await db.select().from(reads).where(eq(reads.id, id))
    if (!read) return null
    const segs = await db
      .select()
      .from(audioSegments)
      .where(eq(audioSegments.readId, id))
      .orderBy(audioSegments.segmentIndex)
    return { read, segments: segs }
  }

  async function createRead(title: string, content: string, type: 'text' | 'url' | 'file' = 'text', sourceUrl?: string, fileName?: string): Promise<number> {
    const db = await getDb()
    const sentences = splitSentences(content)

    const [inserted] = await db.insert(reads).values({
      title,
      content,
      type,
      sourceUrl: sourceUrl ?? null,
      fileName: fileName ?? null,
    }).returning({ id: reads.id })

    const segmentRows = sentences.map((text, index) => ({
      readId: inserted.id,
      segmentIndex: index,
      text,
    }))

    if (segmentRows.length > 0) {
      await db.insert(audioSegments).values(segmentRows)
    }

    await persist()
    await fetchReads()
    return inserted.id
  }

  async function updateRead(id: number, data: { title?: string; progressSegment?: number; progressWord?: number }) {
    const db = await getDb()
    await db.update(reads).set({ ...data, updatedAt: new Date() }).where(eq(reads.id, id))
    await persist()
  }

  async function deleteRead(id: number) {
    const db = await getDb()
    await db.delete(reads).where(eq(reads.id, id))
    await deleteAudioForRead(id)
    await persist()
    await fetchReads()
  }

  return {
    reads: readonly(libraryReads),
    loading: readonly(loading),
    fetchReads,
    getRead,
    createRead,
    updateRead,
    deleteRead,
  }
}
