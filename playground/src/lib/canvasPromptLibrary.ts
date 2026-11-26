import { getOwnerScopedKey } from './workbenchOwner'

export interface CanvasPromptEntry {
  id: string
  title: string
  prompt: string
  tags: string[]
  updatedAt: number
}

const STORAGE_KEY = 'gpt-image-playground-canvas-prompts-v1'

function normalizeEntry(value: unknown): CanvasPromptEntry | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.prompt !== 'string' || !item.prompt.trim()) return null
  const tags = Array.isArray(item.tags) ? Array.from(new Set(item.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean))).slice(0, 30) : []
  return { id: item.id, title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '未命名提示词', prompt: item.prompt.trim(), tags, updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0 }
}

export function normalizeCanvasPromptLibrary(value: unknown): CanvasPromptEntry[] {
  return Array.isArray(value) ? value.flatMap((item) => { const normalized = normalizeEntry(item); return normalized ? [normalized] : [] }).sort((a, b) => b.updatedAt - a.updatedAt) : []
}

export function loadCanvasPromptLibrary(): CanvasPromptEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(getOwnerScopedKey(STORAGE_KEY)) || '[]')
    return normalizeCanvasPromptLibrary(parsed)
  } catch { return [] }
}

export function saveCanvasPromptLibrary(entries: CanvasPromptEntry[]): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(getOwnerScopedKey(STORAGE_KEY), JSON.stringify(normalizeCanvasPromptLibrary(entries))) } catch { /* 忽略不可用的本地存储 */ }
}

export function clearCanvasPromptLibrary(): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.removeItem(getOwnerScopedKey(STORAGE_KEY)) } catch { /* 忽略不可用的本地存储 */ }
}

