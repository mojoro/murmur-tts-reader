// composables/useOffline.ts
import { ref, readonly } from 'vue'
import { getAllMutations, removeMutation } from '~/utils/offline-queue'
import type { OfflineMutation } from '~/types/api'

const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
const isSyncing = ref(false)
const pendingCount = ref(0)
let listenersAttached = false

async function updatePendingCount() {
  try {
    const mutations = await getAllMutations()
    pendingCount.value = mutations.length
  } catch {
    // IndexedDB unavailable during SSR
  }
}

async function processQueue(): Promise<void> {
  if (isSyncing.value) return
  const mutations = await getAllMutations()
  if (mutations.length === 0) return

  isSyncing.value = true
  pendingCount.value = mutations.length

  // Sort by timestamp
  mutations.sort((a, b) => a.timestamp - b.timestamp)

  // Deduplicate progress updates: keep only the latest PATCH per URL
  const latestPatch = new Map<string, OfflineMutation>()
  const nonPatch: OfflineMutation[] = []

  for (const m of mutations) {
    if (m.method === 'PATCH' && /\/api\/reads\/\d+$/.test(m.url)) {
      latestPatch.set(m.url, m)
    } else {
      nonPatch.push(m)
    }
  }

  const toProcess = [...nonPatch, ...latestPatch.values()]
  toProcess.sort((a, b) => a.timestamp - b.timestamp)

  // IDs of mutations we'll skip (deduplicated away)
  const processIds = new Set(toProcess.map((m) => m.id))
  const skippedIds = mutations.filter((m) => !processIds.has(m.id)).map((m) => m.id)

  // Remove skipped duplicates
  for (const id of skippedIds) {
    await removeMutation(id)
  }

  // Replay remaining mutations
  for (const mutation of toProcess) {
    try {
      await $fetch(mutation.url, {
        method: mutation.method as any,
        body: mutation.body as any,
      })
    } catch (error: any) {
      // If resource is gone (404) or conflict (409), skip it
      const status = error?.statusCode || error?.status
      if (status !== 404 && status !== 409) {
        // Unexpected error — stop processing, keep remaining mutations
        console.warn('Offline mutation replay failed, will retry later:', mutation.url, error)
        isSyncing.value = false
        await updatePendingCount()
        return
      }
    }
    await removeMutation(mutation.id)
    pendingCount.value--
  }

  isSyncing.value = false
  pendingCount.value = 0
}

function attachListeners() {
  if (typeof window === 'undefined' || listenersAttached) return
  listenersAttached = true

  window.addEventListener('online', () => {
    isOnline.value = true
    processQueue()
  })
  window.addEventListener('offline', () => {
    isOnline.value = false
  })

  // Load initial pending count
  updatePendingCount()
}

export function useOffline() {
  attachListeners()

  return {
    isOnline: readonly(isOnline),
    isSyncing: readonly(isSyncing),
    pendingCount: readonly(pendingCount),
    processQueue,
  }
}
