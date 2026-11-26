import { getOwnerScopedKey } from './workbenchOwner'

export type GalleryDensity = 'compact' | 'standard' | 'large'

export interface GalleryDensitySpec {
  id: GalleryDensity
  label: string
  description: string
  /** 桌面端单列目标步长（卡片宽 + 间距） */
  desktopStep: number
  /** 网格间距（px） */
  gap: number
  /** 窄屏（< 600px）列数 */
  mobileColumns: number
  /** 虚拟滚动初始估算卡片高度（px），实测后会自动收敛 */
  estimatedCardHeight: number
}

export const DEFAULT_GALLERY_DENSITY: GalleryDensity = 'standard'
export const GALLERY_DENSITY_STORAGE_KEY = 'gpt-image-playground-gallery-density'

export const GALLERY_DENSITY_SPECS: Record<GalleryDensity, GalleryDensitySpec> = {
  compact: {
    id: 'compact',
    label: '紧凑',
    description: '紧凑视图（一屏更多作品）',
    desktopStep: 168,
    gap: 10,
    mobileColumns: 3,
    estimatedCardHeight: 168,
  },
  standard: {
    id: 'standard',
    label: '标准',
    description: '标准视图（平衡数量与细节）',
    desktopStep: 220,
    gap: 12,
    mobileColumns: 2,
    estimatedCardHeight: 220,
  },
  large: {
    id: 'large',
    label: '大图',
    description: '大图视图（赏析细节）',
    desktopStep: 296,
    gap: 16,
    mobileColumns: 1,
    estimatedCardHeight: 290,
  },
}

export const GALLERY_DENSITY_OPTIONS: GalleryDensitySpec[] = [
  GALLERY_DENSITY_SPECS.compact,
  GALLERY_DENSITY_SPECS.standard,
  GALLERY_DENSITY_SPECS.large,
]

export function isGalleryDensity(value: unknown): value is GalleryDensity {
  return value === 'compact' || value === 'standard' || value === 'large'
}

export function getGalleryDensitySpec(density: GalleryDensity): GalleryDensitySpec {
  return GALLERY_DENSITY_SPECS[density] ?? GALLERY_DENSITY_SPECS[DEFAULT_GALLERY_DENSITY]
}

export function computeGalleryColumns(width: number, density: GalleryDensity): number {
  const spec = getGalleryDensitySpec(density)
  if (!Number.isFinite(width) || width <= 0) return spec.mobileColumns
  if (width < 600) return spec.mobileColumns
  return Math.max(2, Math.floor((width + spec.gap) / spec.desktopStep))
}

export function loadGalleryDensity(): GalleryDensity {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_GALLERY_DENSITY
    const saved = window.localStorage.getItem(getOwnerScopedKey(GALLERY_DENSITY_STORAGE_KEY))
    return isGalleryDensity(saved) ? saved : DEFAULT_GALLERY_DENSITY
  } catch {
    return DEFAULT_GALLERY_DENSITY
  }
}

export function saveGalleryDensity(density: GalleryDensity): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(getOwnerScopedKey(GALLERY_DENSITY_STORAGE_KEY), density)
  } catch {
    // 忽略无痕模式或受限存储环境错误
  }
}
