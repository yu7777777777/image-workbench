import type { ImageAnchorComment } from '../types'

export type { ImageAnchorComment } from '../types'

export interface Point {
  x: number
  y: number
}

/** 归一化坐标 (0~1) 的锚点输入框内容；text 为正在编辑但尚未提交的文字 */
export interface PendingComment {
  x: number
  y: number
  text: string
}

/** 锚点提交后输入框应有的状态：cleared 关闭输入框，keep 保留并改写草稿 */
export type PendingCommentState =
  | { kind: 'cleared' }
  | { kind: 'keep'; draft: PendingComment }

export interface CanvasCommentsResult {
  comments: ImageAnchorComment[]
  pending: PendingCommentState
}

/**
 * 锚点圆圈半径。锚点用 canvas 上下文（固有像素）绘制，因此这里是固有像素单位；
 * 画面被 CSS 缩小显示时视觉半径会同比缩小 —— 因此注释里统一把它当作「显示像素」半径来用，
 * 两侧（绘制与命中）误差同一比例，视觉上仍对得上。
 */
export const ANCHOR_RADIUS = 13
/** 锚点可点击范围在半径基础上额外放宽的像素 */
export const ANCHOR_HIT_PADDING = 4
/** text 字段上限，与后端 services/image_comments.py 的 MAX_COMMENT_TEXT_LENGTH 对齐 */
export const COMMENT_TEXT_MAX_LENGTH = 2000
/** 图片编辑用 canvas 的最大边长，坐标归一化前会把显示坐标换算回画布像素 */
export const MAX_SIZE = 1600

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

/**
 * 锚点命中判定。
 * comments 里存的是 0~1 归一化坐标，point 也必须是同一坐标系下的 0~1 坐标；
 * displayWidth/displayHeight 传画布的「显示尺寸」，命中半径按显示像素计算，
 * 这样无论画布被 CSS 缩小多少，可点击范围都约等于看到的圆圈大小（约 17px 显示像素）。
 */
export function commentAnchorHitIndex(
  comments: readonly ImageAnchorComment[],
  point: Point,
  displayWidth: number,
  displayHeight: number,
): number {
  const width = Math.max(1, displayWidth)
  const height = Math.max(1, displayHeight)
  const hitRadius = ANCHOR_RADIUS + ANCHOR_HIT_PADDING
  return comments.findIndex((comment) => Math.hypot((comment.x - point.x) * width, (comment.y - point.y) * height) <= hitRadius)
}

/**
 * 提交锚点输入框：保存/更新一条锚点，并返回输入框的新状态。
 * - 有文字：按 activeIndex 新增或就地更新；
 * - 无文字（含空白）且存在 activeIndex：保留占位锚点（文字置空），用户后续可再点它补文字；
 * - 无文字且没有 activeIndex：**仍然落一个占位锚点**，保证「单击画布就能立刻看到编号圆圈」。
 *
 * 注意：删除语义只走 UI 的「删除」按钮（由调用方先移除再关输入框），
 * 这里不再把空文本当作删除，否则失焦（onBlur）/回车会把刚点出来的锚点静默丢掉。
 *
 * 坐标空间：全流程只有一套 —— 0~1 的「显示归一化坐标」，与 canvasPoint() 点击时算出的值同源。
 * 这里只做 clamp01 兜底，绝不再乘任何缩放系数；否则 0.3 会被乘成 >1 后被夹到 1，
 * 锚点直接跑到右下角（就是「评论框跑下面去了」的根因）。
 */
export function buildCanvasImageComments(
  comments: readonly ImageAnchorComment[],
  draft: PendingComment | null,
  activeIndex: number | null,
): CanvasCommentsResult {
  const activeTarget = activeIndex !== null ? comments[activeIndex] : undefined
  const text = draft?.text.trim() ?? ''
  const source = draft ?? activeTarget ?? null
  if (!source) return { comments: [...comments], pending: { kind: 'cleared' } }

  const x = clamp01(source.x)
  const y = clamp01(source.y)
  // 已有锚点就地更新：位置沿用锚点自身的坐标，避免草稿坐标（可能来自别处）改写已落下的锚点
  const next = activeTarget !== undefined && activeIndex !== null
    ? comments.map((comment, index) => index === activeIndex ? { ...comment, text } : comment)
    : [...comments, { x, y, text, image_index: 0 }]
  // 坐标被夹紧过才需要「保持输入框 + 同步草稿坐标」，正常点击（已在 0~1 内）直接关闭草稿
  const needsClamp = x !== source.x || y !== source.y

  return {
    comments: next,
    pending: needsClamp ? { kind: 'keep', draft: { x, y, text: '' } } : { kind: 'cleared' },
  }
}
