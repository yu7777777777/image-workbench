// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import {
  DEFAULT_GALLERY_DENSITY,
  GALLERY_DENSITY_STORAGE_KEY,
  computeGalleryColumns,
  getGalleryDensitySpec,
  loadGalleryDensity,
  saveGalleryDensity,
} from './galleryDensity'

describe('galleryDensity', () => {
  beforeEach(() => {
    window.localStorage.removeItem(GALLERY_DENSITY_STORAGE_KEY)
  })

  it('computes denser column counts as density increases on desktop widths', () => {
    const compact = computeGalleryColumns(1800, 'compact')
    const standard = computeGalleryColumns(1800, 'standard')
    const large = computeGalleryColumns(1800, 'large')

    expect(compact).toBe(10)
    expect(standard).toBe(8)
    expect(large).toBe(6)
    expect(compact).toBeGreaterThan(standard)
    expect(standard).toBeGreaterThan(large)
  })

  it('adapts 1440px desktop width to balanced column counts', () => {
    expect(computeGalleryColumns(1320, 'compact')).toBe(7)
    expect(computeGalleryColumns(1320, 'standard')).toBe(6)
    expect(computeGalleryColumns(1320, 'large')).toBe(4)
  })

  it('uses density-appropriate column counts on narrow mobile viewports', () => {
    expect(computeGalleryColumns(390, 'compact')).toBe(3)
    expect(computeGalleryColumns(390, 'standard')).toBe(2)
    expect(computeGalleryColumns(390, 'large')).toBe(1)
  })

  it('persists and loads valid gallery density with safe fallback', () => {
    expect(loadGalleryDensity()).toBe(DEFAULT_GALLERY_DENSITY)

    saveGalleryDensity('compact')
    expect(loadGalleryDensity()).toBe('compact')

    window.localStorage.setItem(GALLERY_DENSITY_STORAGE_KEY, 'invalid-value')
    expect(loadGalleryDensity()).toBe(DEFAULT_GALLERY_DENSITY)
  })

  it('returns matching gaps for grid layout and marquee selection', () => {
    expect(getGalleryDensitySpec('compact').gap).toBe(10)
    expect(getGalleryDensitySpec('standard').gap).toBe(12)
    expect(getGalleryDensitySpec('large').gap).toBe(16)
  })
})
