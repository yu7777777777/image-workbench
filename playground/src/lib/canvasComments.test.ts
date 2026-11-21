import { describe, expect, it } from 'vitest'
import { ANCHOR_RADIUS, ANCHOR_HIT_PADDING, COMMENT_TEXT_MAX_LENGTH, MAX_SIZE, buildCanvasImageComments, commentAnchorHitIndex } from './canvasComments'
import type { ImageAnchorComment, Point } from './canvasComments'

const anchor = (x: number, y: number, text = 't'): ImageAnchorComment => ({ x, y, text, image_index: 0 })

describe('commentAnchorHitIndex', () => {
  it('returns -1 when there is no anchor at the point', () => {
    expect(commentAnchorHitIndex([anchor(0.1, 0.1)], { x: 0.9, y: 0.9 }, 1200, 800)).toBe(-1)
  })

  it('measures the hit distance in display pixels, not intrinsic canvas pixels', () => {
    // 画布显示宽度 600（固有 1200）：命中半径按显示像素算，约 17px 显示距离
    const display = 600
    const hitRadius = ANCHOR_RADIUS + ANCHOR_HIT_PADDING
    const withinPixels = hitRadius - 1
    expect(commentAnchorHitIndex([anchor(0.5 + withinPixels / display, 0.5)], { x: 0.5, y: 0.5 }, display, 400)).toBe(0)
    // 超出显示半径哪怕一点点就不算命中
    expect(commentAnchorHitIndex([anchor(0.5 + (hitRadius + 2) / display, 0.5)], { x: 0.5, y: 0.5 }, display, 400)).toBe(-1)
  })

  it('returns the first matching anchor when anchors overlap', () => {
    expect(commentAnchorHitIndex([anchor(0.5, 0.5), anchor(0.501, 0.5)], { x: 0.5, y: 0.5 }, 1200, 800)).toBe(0)
  })
})

describe('buildCanvasImageComments', () => {
  it('commits the pending draft and clears pending state', () => {
    const result = buildCanvasImageComments([anchor(0.1, 0.2, '第一处')], { x: 0.5, y: 0.6, text: '  改成红色  ' }, null)
    expect(result.comments).toEqual([anchor(0.1, 0.2, '第一处'), { x: 0.5, y: 0.6, text: '改成红色', image_index: 0 }])
    expect(result.pending).toEqual({ kind: 'cleared' })
  })

  it('updates an existing anchor in place when one is active', () => {
    const result = buildCanvasImageComments([anchor(0.1, 0.2, '旧文字')], { x: 0.1, y: 0.2, text: '新文字' }, 0)
    expect(result.comments).toEqual([anchor(0.1, 0.2, '新文字')])
    expect(result.pending).toEqual({ kind: 'cleared' })
  })

  it('keeps a placeholder anchor when a brand-new anchor is submitted without text', () => {
    // 关键回归：单击画布 -> 失焦（onBlur）/回车属于这条路径，空文本不能再把锚点丢掉
    const committed = buildCanvasImageComments([anchor(0.7, 0.8)], { x: 0.3, y: 0.3, text: '' }, null)
    expect(committed.comments).toEqual([anchor(0.7, 0.8), anchor(0.3, 0.3, '')])
    expect(committed.pending).toEqual({ kind: 'cleared' })
  })

  it('keeps placeholder anchors for other blur-like inputs (blank text, active anchor, no draft)', () => {
    const blank = buildCanvasImageComments([anchor(0.1, 0.2, '旧文字')], { x: 0.1, y: 0.2, text: '   ' }, 0)
    expect(blank.comments).toEqual([anchor(0.1, 0.2, '')])
    expect(blank.pending).toEqual({ kind: 'cleared' })

    const noDraft = buildCanvasImageComments([anchor(0.7, 0.8), anchor(0.3, 0.3)], null, 1)
    expect(noDraft.comments).toEqual([anchor(0.7, 0.8), anchor(0.3, 0.3, '')])
    expect(noDraft.pending).toEqual({ kind: 'cleared' })

    const nothing = buildCanvasImageComments([anchor(0.7, 0.8)], null, null)
    expect(nothing.comments).toEqual([anchor(0.7, 0.8)])
    expect(nothing.pending).toEqual({ kind: 'cleared' })
  })

  it('stores display-normalized coordinates verbatim (no second scaling)', () => {
    // 回归：点 (0.3, 0.4) 存进去再取出来还是 (0.3, 0.4)。
    // 之前 saveDraftComment 传了 canvas.width/displayWidth（例如 2.4），0.3*2.4=0.72、0.4*2.4=0.96，
    // 再点一次就 >1 被 clamp 到 1，锚点被顶到右下角 —— 即「评论框跑到图片下方」的根因。
    const clicked = { x: 0.3, y: 0.4, text: '把这里改成红色' }
    const saved = buildCanvasImageComments([], clicked, null)
    expect(saved.comments).toEqual([{ x: 0.3, y: 0.4, text: '把这里改成红色', image_index: 0 }])
    expect(saved.pending).toEqual({ kind: 'cleared' })

    // 取出来（重新打开该锚点的输入框）坐标不变，再次提交也不漂移
    const stored = saved.comments[0]
    expect({ x: stored.x, y: stored.y }).toEqual({ x: 0.3, y: 0.4 })
    const edited = buildCanvasImageComments(saved.comments, { x: stored.x, y: stored.y, text: '改成蓝色' }, 0)
    expect(edited.comments[0]).toEqual({ x: 0.3, y: 0.4, text: '改成蓝色', image_index: 0 })
  })

  it('keeps an existing anchor position when only its text is edited', () => {
    const result = buildCanvasImageComments([anchor(0.25, 0.75, '旧')], { x: 0.9, y: 0.9, text: '新' }, 0)
    expect(result.comments).toEqual([anchor(0.25, 0.75, '新')])
  })

  it('keeps the pending input when the edit anchor index is stale', () => {
    const stale = buildCanvasImageComments([], { x: 0.2, y: 0.3, text: '文字' }, 5)
    expect(stale.comments).toEqual([{ x: 0.2, y: 0.3, text: '文字', image_index: 0 }])
    expect(stale.pending).toEqual({ kind: 'cleared' })
  })

  it('clamps coordinates into 0~1 and marks the pending anchor when clamping happens', () => {
    const result = buildCanvasImageComments([], { x: 1.4, y: -0.2, text: '越界' }, null)
    expect(result.comments[0]).toEqual({ x: 1, y: 0, text: '越界', image_index: 0 })
    // 越界坐标夹紧后要保留输入框（已经落锚，实际会把画笔停在新位置的手感交给用户），草稿坐标同步为夹紧后的值
    expect(result.pending).toEqual({ kind: 'keep', draft: { x: 1, y: 0, text: '' } })
  })

  it('keeps the constants aligned with the backend limits', () => {
    expect(COMMENT_TEXT_MAX_LENGTH).toBe(2000)
    expect(MAX_SIZE).toBe(1600)
    expect(ANCHOR_RADIUS).toBe(13)
    expect(ANCHOR_HIT_PADDING).toBe(4)
  })
})
