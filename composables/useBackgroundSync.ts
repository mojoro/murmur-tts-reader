// composables/useBackgroundSync.ts
import type { ReadSummary, ReadDetail } from '~/types/api'
import JSZip from 'jszip'

const SYNC_SETTING_KEY = 'murmur-auto-sync-v2'
const SYNC_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes
const AUDIO_CACHE_NAME = 'audio-cache'
const DELAY_BETWEEN_READS_MS = 3000 // pause between syncing each read
const BUNDLE_BATCH_SIZE = 30 // max segments per bundle request (avoids huge single zip)
const DELAY_BETWEEN_BATCHES_MS = 1000 // pause between batches within a read

const lastSyncAt = ref<number>(0)
const syncing = ref(false)

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

  /** Build a Set of all paths currently in the audio cache (single API call). */
  async function getCachedAudioPaths(): Promise<Set<string>> {
    const cache = await caches.open(AUDIO_CACHE_NAME)
    const keys = await cache.keys()
    return new Set(keys.map((r) => new URL(r.url).pathname))
  }

  /** Download a bundle of specific segments and populate the SW cache. */
  async function syncAudioBundle(readId: number, segmentIndices: number[]) {
    const query = segmentIndices.join(',')
    const resp = await fetch(`/api/audio/${readId}/bundle?segments=${query}`)
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

    try {
      // Warm the library page cache (SSR HTML for offline navigation)
      await fetch('/')

      // Fetch reads list (warms SW cache for /api/reads)
      const reads = await $fetch<ReadSummary[]>('/api/reads')

      // One cache lookup to know what audio we already have
      const cached = await getCachedAudioPaths()

      for (const read of reads) {
        if (!isOnline.value) break

        // Warm the read page cache (SSR HTML for offline navigation)
        await fetch(`/read/${read.id}`)

        // Fetch read detail + bookmarks (warms SW cache)
        const detail = await $fetch<ReadDetail>(`/api/reads/${read.id}`)
        await $fetch(`/api/reads/${read.id}/bookmarks`)

        // Determine which audio segments are missing from cache
        const uncached = detail.segments
          .filter((s) => s.audio_generated)
          .filter((s) => !cached.has(`/api/audio/${s.read_id}/${s.segment_index}`))
          .map((s) => s.segment_index)

        if (uncached.length === 0) continue

        // Fetch missing segments in small batches to avoid one huge zip
        // that can saturate WiFi TX queues and crash some chipsets
        for (let i = 0; i < uncached.length; i += BUNDLE_BATCH_SIZE) {
          if (!isOnline.value) break
          const batch = uncached.slice(i, i + BUNDLE_BATCH_SIZE)
          await syncAudioBundle(read.id, batch)
          if (i + BUNDLE_BATCH_SIZE < uncached.length) {
            await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS))
          }
        }

        // Pause between reads to avoid saturating the network
        if (isOnline.value) {
          await new Promise((r) => setTimeout(r, DELAY_BETWEEN_READS_MS))
        }
      }

      // Voices list
      await $fetch('/api/voices')

      lastSyncAt.value = Date.now()
    } catch {
      // Sync is best-effort; swallow errors (likely went offline)
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
