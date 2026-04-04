import { ref, readonly } from 'vue'

const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
const isSyncing = ref(false)
const pendingCount = ref(0)
let listenersAttached = false

function attachListeners() {
  if (typeof window === 'undefined' || listenersAttached) return
  listenersAttached = true
  window.addEventListener('online', () => { isOnline.value = true })
  window.addEventListener('offline', () => { isOnline.value = false })
}

export function useOffline() {
  attachListeners()

  return {
    isOnline: readonly(isOnline),
    isSyncing: readonly(isSyncing),
    pendingCount: readonly(pendingCount),
  }
}
