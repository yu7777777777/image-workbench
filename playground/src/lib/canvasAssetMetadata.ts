export interface CanvasAssetMetadata {
  category: string
  tags: string[]
}

export type CanvasAssetMetadataMap = Record<string, CanvasAssetMetadata>

const STORAGE_KEY = 'gpt-image-playground-canvas-asset-metadata-v1'

export function createCanvasAssetKey(taskId: string, imageId: string, outputIndex: number): string {
  return `${taskId}:${imageId}:${outputIndex}`
}

export function normalizeCanvasAssetMetadata(value: unknown): CanvasAssetMetadata {
  if (!value || typeof value !== 'object') return { category: '', tags: [] }
  const record = value as Record<string, unknown>
  const category = typeof record.category === 'string' ? record.category.trim() : ''
  const tags = Array.isArray(record.tags)
    ? Array.from(new Set(record.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean))).slice(0, 30)
    : []
  return { category, tags }
}

export function loadCanvasAssetMetadata(): CanvasAssetMetadataMap {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => {
      const metadata = normalizeCanvasAssetMetadata(value)
      return metadata.category || metadata.tags.length ? [[key, metadata]] : []
    }))
  } catch {
    return {}
  }
}

export function saveCanvasAssetMetadata(metadata: CanvasAssetMetadataMap): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metadata))
  } catch {
    // 存储空间不足时素材本身仍可正常使用。
  }
}

export function clearCanvasAssetMetadata(): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* 忽略不可用的本地存储 */ }
}

export function updateCanvasAssetMetadata(key: string, value: Partial<CanvasAssetMetadata>, current = loadCanvasAssetMetadata()): CanvasAssetMetadataMap {
  const nextValue = normalizeCanvasAssetMetadata({ ...current[key], ...value })
  const next = { ...current }
  if (!nextValue.category && !nextValue.tags.length) delete next[key]
  else next[key] = nextValue
  saveCanvasAssetMetadata(next)
  return next
}

