import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCanvasPromptLibrary, saveCanvasPromptLibrary } from './canvasPromptLibrary'

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
})
afterEach(() => vi.unstubAllGlobals())

describe('canvas prompt library', () => {
  it('loads valid saved prompts in most-recent order', () => {
    saveCanvasPromptLibrary([{ id: 'older', title: '旧提示词', prompt: 'old', tags: [], updatedAt: 1 }, { id: 'newer', title: '新提示词', prompt: 'new', tags: ['产品'], updatedAt: 2 }])
    expect(loadCanvasPromptLibrary().map((item) => item.id)).toEqual(['newer', 'older'])
  })
})

