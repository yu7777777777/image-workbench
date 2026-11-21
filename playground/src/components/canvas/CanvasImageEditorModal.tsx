import { ImageAnnotatorModal } from '../ImageAnnotatorModal'
import type { ImageAnnotatorResult } from '../ImageAnnotatorModal'
import type { ImageAnchorComment } from '../../types'

/** 评论锚点：统一使用 types.ts 中的定义，避免两份结构漂移 */
export type CanvasImageComment = ImageAnchorComment
export interface CanvasImageEditResult {
  imageIds: string[]
  maskDataUrl?: string
  comments?: ImageAnchorComment[]
}

interface CanvasImageEditorModalProps {
  imageId: string
  onClose: () => void
  onApply: (result: CanvasImageEditResult) => void | Promise<void>
}

/**
 * 画布图片编辑器。
 * 实现已抽到通用组件 ImageAnnotatorModal（画廊详情弹窗复用同一份实现），
 * 这里只做一层薄封装，保持原有 props / 导出名不变，避免改动画布链路。
 */
export function CanvasImageEditorModal({ imageId, onClose, onApply }: CanvasImageEditorModalProps) {
  return (
    <ImageAnnotatorModal
      imageId={imageId}
      title="编辑图片"
      applyLabel="应用到画布"
      onClose={onClose}
      onApply={(result: ImageAnnotatorResult) => onApply({
        imageIds: result.imageIds,
        maskDataUrl: result.maskDataUrl,
        comments: result.comments,
      })}
    />
  )
}
