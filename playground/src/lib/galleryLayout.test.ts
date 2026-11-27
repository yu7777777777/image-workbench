// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_GALLERY_LAYOUT_MODE,
  GALLERY_LAYOUT_STORAGE_KEY,
  GALLERY_LAYOUT_OPTIONS,
  isGalleryLayoutMode,
  loadGalleryLayoutMode,
  saveGalleryLayoutMode,
} from './galleryLayout'
import { setWorkbenchOwner } from './workbenchOwner'

describe('galleryLayout', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setWorkbenchOwner('')
  })

  afterEach(() => {
    setWorkbenchOwner('')
  })

  it('defaults to masonry and validates layout modes', () => {
    expect(DEFAULT_GALLERY_LAYOUT_MODE).toBe('masonry')
    expect(GALLERY_LAYOUT_OPTIONS.map((item) => item.id)).toEqual(['masonry', 'grid'])
    expect(isGalleryLayoutMode('masonry')).toBe(true)
    expect(isGalleryLayoutMode('grid')).toBe(true)
    expect(isGalleryLayoutMode('list')).toBe(false)
    expect(loadGalleryLayoutMode()).toBe('masonry')
  })

  it('persists and loads valid layout modes with safe fallback', () => {
    saveGalleryLayoutMode('grid')
    expect(loadGalleryLayoutMode()).toBe('grid')

    window.localStorage.setItem(GALLERY_LAYOUT_STORAGE_KEY, 'unknown')
    expect(loadGalleryLayoutMode()).toBe('masonry')
  })

  it('isolates layout mode preference per workbench owner', () => {
    setWorkbenchOwner('user:alice')
    saveGalleryLayoutMode('grid')
    expect(loadGalleryLayoutMode()).toBe('grid')

    setWorkbenchOwner('user:bob')
    expect(loadGalleryLayoutMode()).toBe('masonry')
    saveGalleryLayoutMode('masonry')

    setWorkbenchOwner('user:alice')
    expect(loadGalleryLayoutMode()).toBe('grid')
  })
})
