import { eq } from 'drizzle-orm'
import { audioSegments } from '~/shared/schema'
import type { AudioSegment } from '~/types/db'

export function useTTS() {
  const { getDb, persist } = useDatabase()
  const { saveAudio } = useAudioStorage()
  const { settings } = useSettings()

  const generating = ref(false)
  const progress = ref(0)
  const total = ref(0)
  const error = ref<string | null>(null)
  const aborted = ref(false)

  let abortController: AbortController | null = null

  async function generate(readId: number, segments: AudioSegment[], voice: string, language?: string) {
    generating.value = true
    error.value = null
    aborted.value = false
    progress.value = 0

    const ungenerated = segments.filter((s) => !s.audioPath)
    total.value = ungenerated.length
    abortController = new AbortController()

    try {
      for (const segment of ungenerated) {
        if (abortController.signal.aborted) {
          aborted.value = true
          break
        }

        const blob = await generateAudio(
          settings.value.ttsServerUrl,
          segment.text,
          voice,
          language,
        )

        // Save audio blob to IndexedDB
        await saveAudio(readId, segment.segmentIndex, blob)

        // Update segment record with audio path marker
        const db = await getDb()
        const audioPath = `${readId}:${segment.segmentIndex}`
        await db
          .update(audioSegments)
          .set({ audioPath, generatedAt: new Date() })
          .where(eq(audioSegments.id, segment.id))

        // Try alignment if available
        try {
          const alignment = await alignAudio(
            settings.value.alignServerUrl,
            blob,
            segment.text,
          )
          await db
            .update(audioSegments)
            .set({ wordTimingsJson: JSON.stringify(alignment.words) })
            .where(eq(audioSegments.id, segment.id))
        } catch {
          // Alignment is optional — continue without it
        }

        await persist()
        progress.value++
      }
    } catch (e: any) {
      if (!abortController.signal.aborted) {
        error.value = e.message || 'Generation failed'
      }
    } finally {
      generating.value = false
      abortController = null
    }
  }

  function abort() {
    abortController?.abort()
  }

  return {
    generating: readonly(generating),
    progress: readonly(progress),
    total: readonly(total),
    error: readonly(error),
    generate,
    abort,
  }
}
