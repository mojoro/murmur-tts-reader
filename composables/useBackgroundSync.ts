// composables/useBackgroundSync.ts
import type { ReadSummary, ReadDetail } from '~/types/api'

const SYNC_SETTING_KEY = 'murmur-auto-sync'
const SYNC_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

const lastSyncAt = ref<number>(0)
const syncing = ref(false)

export function useBackgroundSync() {
  const { isOnline } = useOffline()

  const autoSyncEnabled = ref(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(SYNC_SETTING_KEY) !== 'false'
      : true,
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
        if (!isOnline.value) break // stop if we went offline mid-sync

        // Fetch read detail (warms SW cache for /api/reads/:id)
        const detail = await $fetch<ReadDetail>(`/api/reads/${read.id}`)

        // Fetch bookmarks (warms SW cache for /api/reads/:id/bookmarks)
        await $fetch(`/api/reads/${read.id}/bookmarks`)

        // Fetch audio for generated segments (warms SW cache for /api/audio/...)
        for (const seg of detail.segments) {
          if (!isOnline.value) break
          if (seg.audio_generated) {
            // Use fetch() directly to avoid ofetch throwing on non-JSON
            await fetch(`/api/audio/${seg.read_id}/${seg.segment_index}`)
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

    if (autoSyncEnabled.value && isOnline.value) {
      syncAll()
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
