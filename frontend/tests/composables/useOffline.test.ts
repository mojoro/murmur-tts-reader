// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('useOffline', () => {
  beforeEach(() => {
    // Reset module state between tests (module-level refs persist)
    vi.resetModules()
  })

  it('reflects navigator.onLine state', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
    const { useOffline } = await import('../../composables/useOffline')
    const { isOnline } = useOffline()
    expect(isOnline.value).toBe(true)
  })

  it('updates when offline event fires', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
    const { useOffline } = await import('../../composables/useOffline')
    const { isOnline } = useOffline()

    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true })
    window.dispatchEvent(new Event('offline'))
    expect(isOnline.value).toBe(false)
  })

  it('updates when online event fires', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true })
    const { useOffline } = await import('../../composables/useOffline')
    const { isOnline } = useOffline()

    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
    window.dispatchEvent(new Event('online'))
    expect(isOnline.value).toBe(true)
  })

  it('exposes isSyncing as false initially', async () => {
    const { useOffline } = await import('../../composables/useOffline')
    const { isSyncing } = useOffline()
    expect(isSyncing.value).toBe(false)
  })

  it('exposes pendingCount as 0 initially', async () => {
    const { useOffline } = await import('../../composables/useOffline')
    const { pendingCount } = useOffline()
    expect(pendingCount.value).toBe(0)
  })
})
