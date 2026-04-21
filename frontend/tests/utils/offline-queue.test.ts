import { describe, it, expect, beforeEach } from 'vitest'
import {
  queueMutation,
  getAllMutations,
  removeMutation,
  clearMutations,
} from '../../utils/offline-queue'

describe('offline-queue', () => {
  beforeEach(async () => {
    await clearMutations()
  })

  it('starts empty', async () => {
    const mutations = await getAllMutations()
    expect(mutations).toEqual([])
  })

  it('queues a mutation and retrieves it', async () => {
    await queueMutation({ url: '/api/reads/1', method: 'PATCH', body: { progress_segment: 5 } })
    const mutations = await getAllMutations()
    expect(mutations).toHaveLength(1)
    expect(mutations[0].url).toBe('/api/reads/1')
    expect(mutations[0].method).toBe('PATCH')
    expect(mutations[0].body).toEqual({ progress_segment: 5 })
    expect(mutations[0].id).toBeTruthy()
    expect(mutations[0].timestamp).toBeGreaterThan(0)
  })

  it('queues multiple mutations', async () => {
    await queueMutation({ url: '/api/reads/1', method: 'PATCH', body: { progress_segment: 1 } })
    await queueMutation({ url: '/api/reads/1/bookmarks', method: 'POST', body: { segment_index: 3 } })
    await queueMutation({ url: '/api/reads/1', method: 'PATCH', body: { progress_segment: 5 } })
    const mutations = await getAllMutations()
    expect(mutations).toHaveLength(3)
    // All timestamps should be positive (IDB getAll returns in key order, not insertion order)
    for (const m of mutations) {
      expect(m.timestamp).toBeGreaterThan(0)
    }
  })

  it('removes a single mutation by id', async () => {
    await queueMutation({ url: '/api/reads/1', method: 'PATCH', body: { progress_segment: 1 } })
    await queueMutation({ url: '/api/reads/2', method: 'PATCH', body: { progress_segment: 3 } })
    const before = await getAllMutations()
    expect(before).toHaveLength(2)

    await removeMutation(before[0].id)
    const after = await getAllMutations()
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(before[1].id)
  })

  it('clears all mutations', async () => {
    await queueMutation({ url: '/api/reads/1', method: 'PATCH', body: {} })
    await queueMutation({ url: '/api/reads/2', method: 'PATCH', body: {} })
    await clearMutations()
    const mutations = await getAllMutations()
    expect(mutations).toEqual([])
  })

  it('assigns unique ids to each mutation', async () => {
    await queueMutation({ url: '/api/reads/1', method: 'PATCH', body: {} })
    await queueMutation({ url: '/api/reads/1', method: 'PATCH', body: {} })
    const mutations = await getAllMutations()
    expect(mutations[0].id).not.toBe(mutations[1].id)
  })
})
