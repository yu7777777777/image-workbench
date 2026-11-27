import { POOL_KEY } from './accountPool'

export interface CreativeItem {
  id: string
  title: string
  display_title: string
  content: string
  kind: 'prompt' | 'skill'
  has_cover: boolean
  is_favorite: boolean
}

export type CanvasCreativeTransfer = { item: CreativeItem; signal: AbortSignal; finish: () => void }

export async function fetchCreative<T>(suffix: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/creative${suffix}`, {
    signal,
    headers: { Authorization: `Bearer ${POOL_KEY}` },
  })
  if (response.status === 404) throw new Error('此条目已删除或不存在')
  if (!response.ok) throw new Error('未能读取创意广场条目')
  return response.json()
}

export async function fetchCreativeCover(id: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(`/api/creative/${id}/cover`, {
    signal,
    headers: { Authorization: `Bearer ${POOL_KEY}` },
  })
  if (!response.ok) throw new Error('示例图读取失败')
  return response.blob()
}

export function appendCreativeText(draft: string, text: string) {
  return draft ? `${draft}\n\n${text}` : text
}
