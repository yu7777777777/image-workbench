// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./accountPool', () => ({
  isPoolBuild: true,
  POOL_KEY: 'pool-placeholder',
}))

import {
  clearAvailableImageModelsCache,
  fetchAvailableImageModelsResult,
  getCachedAvailableImageModels,
} from './modelsCatalog'

describe('modelsCatalog cache and failure handling', () => {
  beforeEach(() => {
    clearAvailableImageModelsCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('caches successful image models and keeps cache on transient failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'gpt-image-2', kind: 'image' },
            { id: 'plus-gpt-image-2', kind: 'image' },
          ],
        }),
      })
      .mockRejectedValueOnce(new Error('ERR_ABORTED'))
    vi.stubGlobal('fetch', fetchMock)

    expect(getCachedAvailableImageModels()).toBeNull()

    const first = await fetchAvailableImageModelsResult()
    expect(first).toEqual({ ok: true, models: ['gpt-image-2', 'plus-gpt-image-2'] })
    expect(getCachedAvailableImageModels()).toEqual(['gpt-image-2', 'plus-gpt-image-2'])

    const second = await fetchAvailableImageModelsResult()
    expect(second).toEqual({ ok: false, models: [] })
    expect(getCachedAvailableImageModels()).toEqual(['gpt-image-2', 'plus-gpt-image-2'])
  })

  it('updates cache to empty list when server explicitly returns HTTP 200 with no image models', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'gpt-image-2', kind: 'image' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    await fetchAvailableImageModelsResult()
    expect(getCachedAvailableImageModels()).toEqual(['gpt-image-2'])

    const empty = await fetchAvailableImageModelsResult()
    expect(empty).toEqual({ ok: true, models: [] })
    expect(getCachedAvailableImageModels()).toEqual([])
  })
})
