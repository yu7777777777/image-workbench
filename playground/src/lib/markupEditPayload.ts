import type { CallApiOptions } from './imageApiShared'

/**
 * 判断是否携带“无提示词也能提交”的编辑素材（锚点评论 / 标注笔迹 / 笔迹图层）。
 * 实现统一放在 imageApiShared，避免同一判断出现两份实现。
 */
export { hasMarkupEditPayload } from './imageApiShared'

export type MarkupEditPayloadOptions = Pick<CallApiOptions, 'comments' | 'markupStrokes' | 'markupOverlays'>
