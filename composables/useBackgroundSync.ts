// composables/useBackgroundSync.ts
import type { ReadSummary, ReadDetail } from '~/types/api'

const SYNC_SETTING_KEY = 'murmur-auto-sync-v2'
const SYNC_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes
const BATCH_SIZE = 5 // audio fetches between pauses
const BATCH_DELAY_MS = 500 // pause between batches to avoid saturating the network

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

  async function syncAll() {
    if (typeof window === 'undefined' || !isOnline.value || syncing.value) return
    syncing.value = true

    try {
      // Fetch reads list (warms SW cache for /api/reads)
      const reads = await $fetch<ReadSummary[]>('/api/reads')

      for (const read of reads) {
        if (!isOnline.value) break

        // Fetch read detail (warms SW cache for /api/reads/:id)
        const detail = await $fetch<ReadDetail>(`/api/reads/${read.id}`)

        // Fetch bookmarks (warms SW cache for /api/reads/:id/bookmarks)
        await $fetch(`/api/reads/${read.id}/bookmarks`)

        // Fetch audio in throttled batches to avoid saturating the network
        const audioSegments = detail.segments.filter((s) => s.audio_generated)
        for (let i = 0; i < audioSegments.length; i += BATCH_SIZE) {
          if (!isOnline.value) break
          const batch = audioSegments.slice(i, i + BATCH_SIZE)
          await Promise.all(
            batch.map((seg) => fetch(`/api/audio/${seg.read_id}/${seg.segment_index}`)),
          )
          // Pause between batches to let other requests through
          if (i + BATCH_SIZE < audioSegments.length) {
            await new Promise((r) => setTimeout(r, BATCH_DELAY_MS))
          }
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
