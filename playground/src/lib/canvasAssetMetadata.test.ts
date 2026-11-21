import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCanvasAssetKey, loadCanvasAssetMetadata, normalizeCanvasAssetMetadata, updateCanvasAssetMetadata } from './canvasAssetMetadata'

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('canvas asset metadata', () => {
  it('creates stable keys and normalizes tags', () => {
    expect(createCanvasAssetKey('task', 'image', 2)).toBe('task:image:2')
    expect(normalizeCanvasAssetMetadata({ category: '  产品  ', tags: [' 红 ', '红', '', 1] })).toEqual({ category: '产品', tags: ['红'] })
  })

  it('persists updates and removes empty records', () => {
    const key = createCanvasAssetKey('task', 'image', 0)
    const saved = updateCanvasAssetMetadata(key, { category: '灵感', tags: ['海报', '海报'] }, {})
    expect(saved[key]).toEqual({ category: '灵感', tags: ['海报'] })
    expect(loadCanvasAssetMetadata()).toEqual(saved)
    expect(updateCanvasAssetMetadata(key, { category: '', tags: [] }, saved)).toEqual({})
    expect(loadCanvasAssetMetadata()).toEqual({})
  })
})

