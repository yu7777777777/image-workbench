import { getOwnerScopedKey } from './workbenchOwner'

export type GalleryLayoutMode = 'masonry' | 'grid'

export interface GalleryLayoutOption {
  id: GalleryLayoutMode
  label: string
  description: string
}

export const DEFAULT_GALLERY_LAYOUT_MODE: GalleryLayoutMode = 'masonry'
export const GALLERY_LAYOUT_STORAGE_KEY = 'gpt-image-playground-gallery-layout'

export const GALLERY_LAYOUT_OPTIONS: GalleryLayoutOption[] = [
  {
    id: 'masonry',
    label: '瀑布流',
    description: '瀑布流视图（按原图比例自然排布）',
  },
  {
    id: 'grid',
    label: '方格',
    description: '规整方格视图（统一正方形排版）',
  },
]

export function isGalleryLayoutMode(value: unknown): value is GalleryLayoutMode {
  return value === 'masonry' || value === 'grid'
}

export function loadGalleryLayoutMode(): GalleryLayoutMode {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_GALLERY_LAYOUT_MODE
    const saved = window.localStorage.getItem(getOwnerScopedKey(GALLERY_LAYOUT_STORAGE_KEY))
    return isGalleryLayoutMode(saved) ? saved : DEFAULT_GALLERY_LAYOUT_MODE
  } catch {
    return DEFAULT_GALLERY_LAYOUT_MODE
  }
}

export function saveGalleryLayoutMode(mode: GalleryLayoutMode): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(getOwnerScopedKey(GALLERY_LAYOUT_STORAGE_KEY), mode)
  } catch {
    // 忽略无痕模式或受限存储环境错误
  }
}
