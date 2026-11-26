// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claimLegacyWorkbenchLocalStorage,
  getOwnerDbName,
  getOwnerScopedKey,
  getWorkbenchOwner,
  LEGACY_OWNER_CLAIM_KEY,
  setWorkbenchOwner,
} from './workbenchOwner'
import { loadCanvasAssetMetadata, saveCanvasAssetMetadata } from './canvasAssetMetadata'
import { loadCanvasPromptLibrary, saveCanvasPromptLibrary } from './canvasPromptLibrary'
import { loadGalleryDensity, saveGalleryDensity } from './galleryDensity'
import { callImageApi } from './api'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS } from './apiProfiles'
import { DEFAULT_PARAMS } from '../types'

describe('workbenchOwner isolation and legacy claim', () => {
  beforeEach(() => {
    localStorage.clear()
    setWorkbenchOwner('')
  })

  afterEach(() => {
    setWorkbenchOwner('')
    vi.restoreAllMocks()
  })

  it('scopes storage keys and DB names by owner and keeps default empty for standalone tests', () => {
    expect(getWorkbenchOwner()).toBe('')
    expect(getOwnerScopedKey('gpt-image-playground')).toBe('gpt-image-playground')
    expect(getOwnerDbName()).toBe('gpt-image-playground')

    setWorkbenchOwner('user:alice')
    expect(getOwnerScopedKey('gpt-image-playground')).toBe('gpt-image-playground:user:alice')
    expect(getOwnerDbName()).toBe('gpt-image-playground:user:alice')
  })

  it('first owner claims legacy localStorage once and second owner starts isolated', () => {
    localStorage.setItem('gpt-image-playground', JSON.stringify({ state: { appMode: 'agent' }, version: 2 }))
    localStorage.setItem('gpt-image-playground-gallery-density', 'compact')
    localStorage.setItem('gpt-image-playground-canvas-asset-metadata-v1', JSON.stringify({ k1: { category: '角色', tags: ['a'] } }))
    localStorage.setItem('gpt-image-playground-canvas-prompts-v1', JSON.stringify([{ id: 'p1', title: 't', prompt: 'hello', tags: [], updatedAt: 1 }]))

    expect(claimLegacyWorkbenchLocalStorage('user:alice')).toBe(true)
    expect(localStorage.getItem(LEGACY_OWNER_CLAIM_KEY)).toBe('user:alice')

    setWorkbenchOwner('user:alice')
    expect(loadGalleryDensity()).toBe('compact')
    expect(loadCanvasAssetMetadata()).toEqual({ k1: { category: '角色', tags: ['a'] } })
    expect(loadCanvasPromptLibrary()).toHaveLength(1)

    // 第二个用户不能认领前者的旧数据，且各自读写互不干扰
    expect(claimLegacyWorkbenchLocalStorage('user:bob')).toBe(false)
    setWorkbenchOwner('user:bob')
    expect(loadGalleryDensity()).toBe('standard')
    expect(loadCanvasAssetMetadata()).toEqual({})
    expect(loadCanvasPromptLibrary()).toEqual([])

    saveGalleryDensity('large')
    saveCanvasAssetMetadata({ k2: { category: '场景', tags: ['b'] } })
    saveCanvasPromptLibrary([{ id: 'p2', title: 'b', prompt: 'world', tags: [], updatedAt: 2 }])

    setWorkbenchOwner('user:alice')
    expect(loadGalleryDensity()).toBe('compact')
    expect(loadCanvasAssetMetadata()).toEqual({ k1: { category: '角色', tags: ['a'] } })
    expect(loadCanvasPromptLibrary()).toHaveLength(1)
  })

  it('aborts underlying image fetch immediately when external AbortSignal aborts', async () => {
    const controller = new AbortController()
    let capturedSignal: AbortSignal | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      capturedSignal = init?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })

    const profile = createDefaultOpenAIProfile({
      id: 'openai-cancel-test',
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com/v1',
      apiMode: 'images',
    })
    const pending = callImageApi({
      settings: { ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id },
      prompt: 'draw a cat',
      params: DEFAULT_PARAMS,
      inputImageDataUrls: [],
      signal: controller.signal,
    })

    await Promise.resolve()
    expect(capturedSignal).toBeDefined()
    expect(capturedSignal?.aborted).toBe(false)
    controller.abort()
    expect(capturedSignal?.aborted).toBe(true)
    await expect(pending).rejects.toThrow()
  })
})
