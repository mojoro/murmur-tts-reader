// composables/useBackgroundSync.ts
import type { ReadSummary, ReadDetail } from '~/types/api'
import JSZip from 'jszip'

const SYNC_SETTING_KEY = 'murmur-auto-sync-v2'
const SYNC_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes
const AUDIO_CACHE_NAME = 'audio-cache'
const DELAY_BETWEEN_READS_MS = 3000 // pause between syncing each read
const BUNDLE_BATCH_SIZE = 30 // max segments per bundle request
const DELAY_BETWEEN_BATCHES_MS = 1000 // pause between batches within a read
const BUNDLE_TIMEOUT_MS = 120_000 // 2 minutes per bundle request

const lastSyncAt = ref<number>(0)
const syncing = ref(false)

let abortController: AbortController | null = null

export function useBackgroundSync() {
  const { isOnline } = useOffline()

  const autoSyncEnabled = ref(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(SYNC_SETTING_KEY) === 'true'
      : false,
  )

  function setAutoSync(enabled: boolean) {
    autoSyncEnabled.value = enabled
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SYNC_SETTING_KEY, String(enabled))
    }
  }

  /** Build a Set of all paths currently in the audio cache. */
  async function getCachedAudioPaths(): Promise<Set<string>> {
    const cache = await caches.open(AUDIO_CACHE_NAME)
    const keys = await cache.keys()
    return new Set(keys.map((r) => new URL(r.url).pathname))
  }

  /** Download a bundle of specific segments and populate the SW cache. */
  async function syncAudioBundle(readId: number, segmentIndices: number[], signal: AbortSignal) {
    const query = segmentIndices.join(',')
    const resp = await fetch(`/api/audio/${readId}/bundle?segments=${query}`, { signal })
    if (!resp.ok) return

    const blob = await resp.blob()
    const zip = await JSZip.loadAsync(blob)
    const cache = await caches.open(AUDIO_CACHE_NAME)

    for (const [filename, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue
      const segIndex = parseInt(filename.replace('.wav', ''), 10)
      if (isNaN(segIndex)) continue

      const data = await entry.async('arraybuffer')
      await cache.put(
        `/api/audio/${readId}/${segIndex}`,
        new Response(data, { headers: { 'Content-Type': 'audio/wav' } }),
      )
    }
  }

  async function syncAll() {
    if (typeof window === 'undefined' || !isOnline.value || syncing.value) return
    syncing.value = true

    // Cancel any previous sync still in flight
    abortController?.abort()
    abortController = new AbortController()
    const { signal } = abortController

    try {
      // Warm the library page cache (SSR HTML for offline navigation)
      await fetch('/', { signal })

      // Fetch reads list (warms SW cache for /api/reads)
      const reads = await $fetch<ReadSummary[]>('/api/reads')

      // One cache lookup to know what audio we already have
      const cached = await getCachedAudioPaths()

      for (const read of reads) {
        if (signal.aborted || !isOnline.value) break

        // Skip reads that are currently being generated (no generated_at yet,
        // or generation is partial) — we'll pick them up on the next sync cycle
        if (!read.generated_at) continue

        // Warm the read page cache (SSR HTML for offline navigation)
        await fetch(`/read/${read.id}`, { signal })

        // Fetch read detail + bookmarks (warms SW cache)
        const detail = await $fetch<ReadDetail>(`/api/reads/${read.id}`)
        await $fetch(`/api/reads/${read.id}/bookmarks`)

        // Determine which audio segments are missing from cache
        const uncached = detail.segments
          .filter((s) => s.audio_generated)
          .filter((s) => !cached.has(`/api/audio/${s.read_id}/${s.segment_index}`))
          .map((s) => s.segment_index)

        if (uncached.length === 0) continue

        // Fetch missing segments in batches
        for (let i = 0; i < uncached.length; i += BUNDLE_BATCH_SIZE) {
          if (signal.aborted || !isOnline.value) break
          const batch = uncached.slice(i, i + BUNDLE_BATCH_SIZE)

          // Per-batch timeout so a single slow download doesn't block the whole sync
          const batchController = new AbortController()
          const timeout = setTimeout(() => batchController.abort(), BUNDLE_TIMEOUT_MS)
          signal.addEventListener('abort', () => batchController.abort(), { once: true })

          try {
            await syncAudioBundle(read.id, batch, batchController.signal)
          } catch (e) {
            if (signal.aborted) break
            // Skip this batch on timeout/error, continue with next
          } finally {
            clearTimeout(timeout)
          }

          if (i + BUNDLE_BATCH_SIZE < uncached.length) {
            await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS))
          }
        }

        // Pause between reads to avoid saturating the network
        if (!signal.aborted && isOnline.value) {
          await new Promise((r) => setTimeout(r, DELAY_BETWEEN_READS_MS))
        }
      }

      // Voices list
      if (!signal.aborted) await $fetch('/api/voices')

      lastSyncAt.value = Date.now()
    } catch {
      // Sync is best-effort; swallow errors (likely went offline or was aborted)
    } finally {
      syncing.value = false
    }
  }

  // Start periodic sync on mount
  let intervalId: ReturnType<typeof setInterval> | undefined

  function startPeriodicSync() {
    if (typeof window === 'undefined') return
    stopPeriodicSync()

    // Delay initial sync to let the page load first
    if (autoSyncEnabled.value && isOnline.value) {
      setTimeout(() => {
        if (autoSyncEnabled.value && isOnline.value) syncAll()
      }, 10_000)
    }

    intervalId = setInterval(() => {
      if (autoSyncEnabled.value && isOnline.value) {
        syncAll()
      }
    }, SYNC_INTERVAL_MS)
  }

  function stopPeriodicSync() {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = undefined
    }
    abortController?.abort()
  }

  return {
    autoSyncEnabled: readonly(autoSyncEnabled),
    syncing: readonly(syncing),
    lastSyncAt: readonly(lastSyncAt),
    setAutoSync,
    syncAll,
    startPeriodicSync,
    stopPeriodicSync,
  }
}
