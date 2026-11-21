import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ensureImageCached } from '../lib/imageCache'
import { canvasToBlob, loadImage } from '../lib/canvasImage'
import { blobToDataUrl } from '../lib/dataUrl'
import { storeImage } from '../lib/db'
import type { ImageAnchorComment } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { ANCHOR_RADIUS, COMMENT_TEXT_MAX_LENGTH, MAX_SIZE, buildCanvasImageComments, commentAnchorHitIndex } from '../lib/canvasComments'
import type { PendingComment } from '../lib/canvasComments'

/** 保留 'mask' 以兼容既有调用方；UI 已把它合并进「画笔」的用途切换，不再单独暴露 */
export type ImageAnnotatorMode = 'crop' | 'brush' | 'mask' | 'resize' | 'grid' | 'comment'
export type ImageAnnotatorPoint = { x: number; y: number }
/** 画笔用途：标注 = 彩色笔迹应用到输出图；遮罩 = 青色半透明笔迹生成遮罩 PNG 送局部重绘 */
export type ImageAnnotatorBrushUsage = 'markup' | 'mask'
/** 评论锚点：统一使用 types.ts 中的定义，避免两份结构漂移 */
export type ImageAnnotatorComment = ImageAnchorComment

/**
 * 评论输入框草稿。
 * x/y 是「存储用的」0~1 归一化坐标（与 canvasPoint 点击时算出的完全同一套坐标空间）；
 * viewLeft/viewTop 是「展示用的」视口像素坐标，只服务于输入框定位，绝不参与保存，
 * 两者分开存放，避免再把显示坐标误当成存储坐标做二次换算。
 */
export interface ImageAnnotatorDraft extends PendingComment {
  viewLeft: number
  viewTop: number
}

/**
 * 图片编辑/标注结果。
 * - imageIds：编辑产物（裁剪/缩放/宫格切分后的新图片），评论锚点模式返回原图 id；
 * - maskDataUrl：遮罩模式产出的遮罩 PNG；
 * - comments：评论锚点模式下已提交的锚点评论；
 * - sourceImageId：本次编辑的源图片 id，便于调用方定位原始图片。
 */
export interface ImageAnnotatorResult {
  imageIds: string[]
  sourceImageId: string
  maskDataUrl?: string
  comments?: ImageAnchorComment[]
}

export interface ImageAnnotatorModalProps {
  imageId: string
  onClose: () => void
  onApply: (result: ImageAnnotatorResult) => void | Promise<void>
  /** 确认按钮文案，默认按模式自动生成 */
  applyLabel?: string
  /** 弹窗标题 */
  title?: string
}

const APPLY_LABEL_FALLBACK = '应用'

const CANVAS_BG_STYLE = {
  backgroundColor: 'oklch(0.967 0.001 286)',
  backgroundImage:
    'repeating-conic-gradient(oklch(0.92 0.004 286) 0% 25%, oklch(0.967 0.001 286) 0% 50%)',
  backgroundSize: '22px 22px',
} as const

const TOOL_BUTTON_BASE =
  'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40'
const TOOL_BUTTON_IDLE =
  'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 dark:bg-white/[0.06] dark:text-zinc-300 dark:hover:bg-white/[0.12] dark:hover:text-white'
const TOOL_BUTTON_ACTIVE = 'bg-blue-500 text-white hover:bg-blue-600'
const FOOTER_BUTTON_BASE =
  'inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40'
const FOOTER_BUTTON_IDLE =
  'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-white/[0.08] dark:text-zinc-200 dark:hover:bg-white/[0.14]'
const FOOTER_BUTTON_PRIMARY = 'bg-blue-500 text-white hover:bg-blue-600 disabled:hover:bg-blue-500'
const FIELD_INPUT_CLASS =
  'h-7 w-14 rounded-md border border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 outline-none focus:border-blue-400 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-zinc-200'
const COMMENT_ANCHOR_FONT = `600 ${ANCHOR_RADIUS}px system-ui`
const COMMENT_ANCHOR_FILL = 'oklch(0.546 0.215 263)'
const COMMENT_ANCHOR_TEXT = 'oklch(1 0 90)'
const HIGHLIGHT_COLOR = 'oklch(0.623 0.188 260)'
const GUIDE_COLOR = 'oklch(0.623 0.188 260)'
const MASK_STROKE_COLOR = 'oklch(0.785 0.133 182  / .55)'
/** 评论输入框与锚点之间的间距、与视口边缘的安全距离（视口像素） */
const COMMENT_FORM_GAP = 12
const COMMENT_FORM_MARGIN = 8
/** 首次渲染量不到真实尺寸时的兜底值（w-64 = 256px） */
const COMMENT_FORM_WIDTH = 256
const COMMENT_FORM_MIN_HEIGHT = 168

export function ImageAnnotatorModal({ imageId, onClose, onApply, applyLabel, title }: ImageAnnotatorModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const startRef = useRef<ImageAnnotatorPoint | null>(null)
  const [mode, setMode] = useState<ImageAnnotatorMode>('crop')
  /** 画笔「用途」：标注（默认）/ 遮罩；遮罩等同于原 mask 模式，只是入口合并 */
  const [brushUsage, setBrushUsage] = useState<ImageAnnotatorBrushUsage>('markup')
  /**
   * 评论锚点。text 为空即「占位锚点」：单击画布立刻出现编号圆圈，用户后续点它即可补文字。
   * 不再用单独的「草稿锚点」状态，避免单击后必须提交才看得见。
   */
  /** 评论输入框 DOM 引用：定位需要量它的真实宽高，才能做翻转与贴边收敛 */
  const commentFormRef = useRef<HTMLFormElement>(null)
  const [comments, setComments] = useState<ImageAnnotatorComment[]>([])
  const [draftComment, setDraftComment] = useState<ImageAnnotatorDraft | null>(null)
  const [activeCommentIndex, setActiveCommentIndex] = useState<number | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 1, height: 1 })
  const [brushSize, setBrushSize] = useState(18)
  const [brushColor, setBrushColor] = useState('oklch(0.546 0.215 263)')
  const [strokes, setStrokes] = useState<ImageAnnotatorPoint[][]>([])
  const [currentStroke, setCurrentStroke] = useState<ImageAnnotatorPoint[]>([])
  const [scale, setScale] = useState(1)
  const [gridRows, setGridRows] = useState(2)
  const [gridCols, setGridCols] = useState(2)
  const [loading, setLoading] = useState(true)
  const [hasImage, setHasImage] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  /**
   * 把图片与当前工具叠加层重绘到 canvas 上。
   * 必须用 useCallback 包裹：它被 imageId 加载 effect 与状态重绘 effect 同时依赖，
   * 每次渲染生成新引用会让后者的依赖永不命中/反复触发。
   * 调用方需自行保证 canvas.width/height 已按图片固有比例设置好。
   */
  /** 画笔族（含合并后的遮罩用途）共用一套指针逻辑与笔迹数据 */
  const brushMode = mode === 'brush' || mode === 'mask'
  const maskUsage = mode === 'mask' || (mode === 'brush' && brushUsage === 'mask')

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const image = imageRef.current
    if (!canvas || !image) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const rect = { x: crop.x * canvas.width, y: crop.y * canvas.height, width: crop.width * canvas.width, height: crop.height * canvas.height }
    if (mode === 'crop') {
      ctx.save()
      ctx.fillStyle = 'oklch(0.000 0.000 0  / .45)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.clearRect(rect.x, rect.y, rect.width, rect.height)
      ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height)
      ctx.strokeStyle = GUIDE_COLOR
      ctx.lineWidth = Math.max(2, canvas.width / 500)
      ctx.setLineDash([8, 6])
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
      ctx.restore()
    }
    if (brushMode) {
      // 标注用途画彩色笔迹，遮罩用途画青色半透明笔迹；两者共用同一套笔画数据
      ctx.save()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (brushUsage === 'mask') {
        ctx.strokeStyle = MASK_STROKE_COLOR
      } else {
        ctx.strokeStyle = brushColor
      }
      ctx.lineWidth = brushSize * (canvas.width / Math.max(1, image.naturalWidth))
      for (const stroke of [...strokes, currentStroke]) {
        if (!stroke || stroke.length < 1) continue
        ctx.beginPath()
        ctx.moveTo(stroke[0].x * canvas.width, stroke[0].y * canvas.height)
        for (const point of stroke.slice(1)) ctx.lineTo(point.x * canvas.width, point.y * canvas.height)
        // 单点（点击未拖动）也要落笔，否则点一下看不到任何反馈
        if (stroke.length === 1) ctx.lineTo(stroke[0].x * canvas.width + 0.1, stroke[0].y * canvas.height)
        ctx.stroke()
      }
      ctx.restore()
    }
    if (mode === 'resize') {
      ctx.save()
      ctx.fillStyle = 'oklch(0.000 0.000 0  / .46)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#fff'
      ctx.font = '600 18px system-ui'
      ctx.textAlign = 'center'
      ctx.fillText(`${Math.round(image.naturalWidth * scale)} × ${Math.round(image.naturalHeight * scale)}`, canvas.width / 2, canvas.height / 2)
      ctx.restore()
    }
    if (mode === 'comment') {
      ctx.save()
      ctx.font = COMMENT_ANCHOR_FONT
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const [index, comment] of (comments ?? []).entries()) {
        if (!comment) continue
        // 空文本锚点照常画编号圆圈：单击画布后立刻可见，用户后续点它补文字
        const x = comment.x * canvas.width
        const y = comment.y * canvas.height
        if (activeCommentIndex === index) {
          ctx.beginPath()
          ctx.arc(x, y, ANCHOR_RADIUS + 6, 0, Math.PI * 2)
          ctx.fillStyle = 'oklch(0.623 0.188 260  / .28)'
          ctx.fill()
        }
        ctx.beginPath()
        ctx.arc(x, y, ANCHOR_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = COMMENT_ANCHOR_FILL
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = 'oklch(1.000 0.000 90  / .85)'
        ctx.stroke()
        ctx.fillStyle = COMMENT_ANCHOR_TEXT
        ctx.fillText(String(index + 1), x, y + 1)
      }
      ctx.restore()
    }
    if (mode === 'grid') {
      ctx.save()
      ctx.strokeStyle = GUIDE_COLOR
      ctx.lineWidth = Math.max(2, canvas.width / 500)
      ctx.setLineDash([8, 6])
      for (let row = 1; row < gridRows; row++) { const y = canvas.height * row / gridRows; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke() }
      for (let col = 1; col < gridCols; col++) { const x = canvas.width * col / gridCols; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke() }
      ctx.restore()
    }
  }, [activeCommentIndex, brushColor, brushMode, brushSize, brushUsage, comments, crop, currentStroke, gridCols, gridRows, mode, scale, strokes])
  /**
   * draw 随 comments/strokes 等视觉状态变化而重建。图片加载 effect 里需要「重绘」，
   * 但绝不能把 draw 放进它的依赖数组 —— 否则每加一个锚点都会重新下载+解码整张图，
   * 导致评论框刚出现就被卸载（历史 bug：点一下画布输入框一闪就没）。
   */
  const drawRef = useRef(draw)
  drawRef.current = draw

  /**
   * 加载图片并初始化画布。canvas 现在是常驻渲染的（loading/error 只是覆盖层），
   * 所以 ref 一定可用；但为稳妥起见仍以 hasImage 作为宽度设置的第二道保障。
   */
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    // 仅当手头确实没有可用图片（首帧、或上一张已清理）才清空，重复执行时不清空，避免闪白
    if (!imageRef.current) setHasImage(false)
    void ensureImageCached(imageId).then((dataUrl) => {
      if (!dataUrl) throw new Error('图片已不存在')
      return loadImage(dataUrl)
    }).then((image) => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) {
        // canvas 理论上常驻，走到这里说明挂载时序异常，直接提示而不是留一张 300x150 的鬼画布
        throw new Error('画布初始化失败，请重试')
      }
      imageRef.current = image
      // 按图片固有比例计算画布固有尺寸（仅做单边上限缩放），保证 1:1 像素绘制，比例不变形
      const ratio = Math.min(1, MAX_SIZE / Math.max(1, image.naturalWidth, image.naturalHeight))
      const nextWidth = Math.max(1, Math.round(image.naturalWidth * ratio))
      const nextHeight = Math.max(1, Math.round(image.naturalHeight * ratio))
      // 尺寸没变就不重新赋值：给 canvas.width/height 赋值会清空位图并触发重排，是画面闪动的来源
      if (canvas.width !== nextWidth) canvas.width = nextWidth
      if (canvas.height !== nextHeight) canvas.height = nextHeight
      setHasImage(true)
      setLoading(false)
      // 尺寸刚设置好，等一帧让浏览器完成布局后立即重绘
      requestAnimationFrame(() => { if (!cancelled) drawRef.current() })
    }).catch((reason: unknown) => { if (!cancelled) { setError(reason instanceof Error ? reason.message : '图片读取失败'); setLoading(false) } })
    return () => { cancelled = true }
    // 故意只依赖 imageId：draw 会随 comments/strokes 变化，
    // 放进依赖数组会导致每次标注都重新加载整张图（评论框被卸载的根因）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId])

  useEffect(() => { if (hasImage) draw() }, [hasImage, draw])

  // 弹窗内统一由本组件接管滚动锁定与 Esc 关闭，避免与下层详情弹窗互相干扰
  usePreventBackgroundScroll(true, [canvasRef])
  useCloseOnEscape(true, () => { if (!saving) onClose() })

  /**
   * 显示坐标 -> 0~1 归一化坐标（整个组件唯一的坐标空间）。
   * 必须用 getBoundingClientRect() 的「显示尺寸」：pointer 事件给的是 CSS 像素，
   * 而 canvas.width/height 是固有像素（可能是 1600x900），两者混用会让锚点整体偏移。
   * 存储、命中判定、输入框定位都只认这一套坐标，任何地方都不再乘缩放系数。
   */
  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>): ImageAnnotatorPoint => {
    const rect = event.currentTarget.getBoundingClientRect()
    const width = Math.max(1, rect.width)
    const height = Math.max(1, rect.height)
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / height)),
    }
  }
  /**
   * 锚点命中判定：comments 存的是 0~1 归一化坐标，点击点也是 0~1，
   * 因此这里把「画布显示尺寸」传给 commentAnchorHitIndex，让半径按显示像素算（视觉上约 17px）。
   */
  const hitTestCommentAnchor = (point: ImageAnnotatorPoint): number => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return -1
    return commentAnchorHitIndex(comments, point, Math.max(1, rect.width), Math.max(1, rect.height))
  }
  /** 归一化坐标 -> 视口像素坐标；点击已有锚点时用它让输入框出现在锚点旁边 */
  const clientPointOfNormalized = (point: ImageAnnotatorPoint): { viewLeft: number; viewTop: number } => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { viewLeft: 0, viewTop: 0 }
    return { viewLeft: rect.left + point.x * rect.width, viewTop: rect.top + point.y * rect.height }
  }
  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (loading || saving) return
    if (mode === 'comment') {
      const click = canvasPoint(event)
      // 输入框定位直接用点击时的视口坐标，与存储用的归一化坐标彻底分开
      const view = { viewLeft: event.clientX, viewTop: event.clientY }
      const hitIndex = hitTestCommentAnchor(click)
      if (hitIndex >= 0) {
        // 点已有锚点（含空文本占位锚点）=> 选中并进入编辑；输入框出现在该锚点在屏幕上的位置
        const target = comments[hitIndex]
        const anchorView = clientPointOfNormalized({ x: target.x, y: target.y })
        setActiveCommentIndex(hitIndex)
        setDraftComment({ x: target.x, y: target.y, text: target.text, ...anchorView })
        return
      }
      // 单击空白处 => 立刻落一个锚点并聚焦输入框；锚点已在 comments 里，失焦也不会消失
      setComments((previous) => [...previous, { x: click.x, y: click.y, text: '', image_index: 0 }])
      setActiveCommentIndex(comments.length)
      setDraftComment({ x: click.x, y: click.y, text: '', ...view })
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = canvasPoint(event)
    if (mode === 'crop') startRef.current = point
    if (brushMode) setCurrentStroke([point])
  }
  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const point = canvasPoint(event)
    if (mode === 'crop' && startRef.current) {
      const start = startRef.current
      setCrop({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.max(.02, Math.abs(point.x - start.x)), height: Math.max(.02, Math.abs(point.y - start.y)) })
    } else if (brushMode) setCurrentStroke((previous) => [...previous, point])
  }
  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (brushMode && currentStroke.length) { setStrokes((previous) => [...previous, currentStroke]); setCurrentStroke([]) }
    startRef.current = null
  }

  const switchMode = (next: ImageAnnotatorMode) => {
    // 切换工具只清掉「正在绘制」的笔迹；已落下的评论锚点必须保留，
    // 否则用户切到别的工具再切回来，辛苦点的锚点就全没了。
    setMode(next); setStrokes([]); setCurrentStroke([])
    if (next !== 'comment') { setDraftComment(null); setActiveCommentIndex(null) }
  }
  /** 切换画笔用途时清空笔迹，避免两种用途的笔迹混在一起 */
  const switchBrushUsage = (next: ImageAnnotatorBrushUsage) => {
    setBrushUsage(next); setStrokes([]); setCurrentStroke([])
  }
  /**
   * 输入框提交规则集中在 lib/canvasComments.ts，便于单测覆盖。
   * @param forceKeep 强制保留输入框（失焦场景）。正常提交时由提交规则决定是否关闭。
   */
  const applyCommentState = (result: ReturnType<typeof buildCanvasImageComments>, forceKeep = false) => {
    setComments(result.comments)
    // 保留展示用的视口坐标：定位基准不变，输入框不会因为一次提交就跳位置
    const keep = forceKeep || result.pending.kind === 'keep'
    setDraftComment((previous) => {
      if (!keep) return null
      const draft = result.pending.kind === 'keep' ? result.pending.draft : { x: previous?.x ?? 0, y: previous?.y ?? 0, text: previous?.text ?? '' }
      return { ...draft, viewLeft: previous?.viewLeft ?? 0, viewTop: previous?.viewTop ?? 0 }
    })
    if (!keep) setActiveCommentIndex(null)
  }
  /**
   * 提交当前输入框。空文本也会保留锚点（占位），所以失焦 / 回车不会让刚点出来的锚点消失。
   * 坐标空间只有一套 0~1 显示归一化坐标，这里不再传任何缩放系数（传 scale 就是「评论框跑偏」的根因）。
   *
   * @param keepOpen 失焦时只把文字写回锚点、不关闭输入框。
   *   autoFocus 会让 textarea 刚拿到焦点就被浏览器收尾操作带走（pointerup/click），
   *   失焦即关闭会让输入框「一闪就没」——用户点一下画布根本来不及打字。
   *   关闭统一交给：Enter、保存按钮、Esc、取消按钮。
   */
  const saveDraftComment = (keepOpen = false) => {
    if (!draftComment && activeCommentIndex === null) return
    applyCommentState(buildCanvasImageComments(comments, draftComment, activeCommentIndex), keepOpen)
  }
  /**
   * 输入框定位：完全脱离 wrapper 的百分比体系，改用 position: fixed + 视口像素坐标。
   * 锚点视口坐标已知（点击点或锚点本身），量出输入框实际宽高后收敛到视口内：
   * 右侧放不下就翻到左侧，下方放不下就翻到上方，仍然放不下就贴边 —— 绝不会跑到画布外面看不见的地方。
   */
  const placeCommentForm = useCallback(() => {
    const form = commentFormRef.current
    if (!form) return
    const gap = COMMENT_FORM_GAP
    const margin = COMMENT_FORM_MARGIN
    const anchorX = draftComment?.viewLeft ?? 0
    const anchorY = draftComment?.viewTop ?? 0
    const width = form.offsetWidth || COMMENT_FORM_WIDTH
    const height = form.offsetHeight || COMMENT_FORM_MIN_HEIGHT
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const overflowRight = anchorX + gap + width > viewportWidth - margin
    const overflowBottom = anchorY + gap + height > viewportHeight - margin
    const preferredLeft = overflowRight ? anchorX - gap - width : anchorX + gap
    const preferredTop = overflowBottom ? anchorY - gap - height : anchorY + gap
    const clamp = (value: number, max: number) => Math.round(Math.max(margin, Math.min(value, Math.max(margin, max))))
    form.style.left = `${clamp(preferredLeft, viewportWidth - margin - width)}px`
    form.style.top = `${clamp(preferredTop, viewportHeight - margin - height)}px`
  }, [draftComment])

  // 草稿出现 / 文字变化（尺寸随之变化）后重新量一次，保证翻转与收敛基于真实尺寸
  useEffect(() => {
    if (!draftComment) return
    placeCommentForm()
    const form = commentFormRef.current
    if (!form || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => placeCommentForm())
    observer.observe(form)
    return () => observer.disconnect()
  }, [draftComment, placeCommentForm])

  // 视口尺寸变化（含移动端键盘弹出）时重新收敛，避免输入框被挤出屏幕
  useEffect(() => {
    if (!draftComment) return
    const handleResize = () => placeCommentForm()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [draftComment, placeCommentForm])

  const deleteComment = () => {
    if (activeCommentIndex !== null) setComments((previous) => previous.filter((_, index) => index !== activeCommentIndex))
    setDraftComment(null); setActiveCommentIndex(null)
  }
  /** 关闭输入框（Esc / 取消）时，空文本的占位锚点没有保留价值，顺手清掉，避免留下无意义编号 */
  const cancelDraftComment = () => {
    if (activeCommentIndex !== null) {
      const target = comments[activeCommentIndex]
      if (target && !target.text.trim()) {
        setComments((previous) => previous.filter((_, index) => index !== activeCommentIndex))
      }
    }
    setDraftComment(null); setActiveCommentIndex(null)
  }

  const apply = async () => {
    const image = imageRef.current
    if (!image || saving) return
    setSaving(true)
    try {
      if (mode === 'comment') {
        // 应用时把输入框里未提交的文字一并算进去，保存/更新/删除共用同一套规则
        const committed = buildCanvasImageComments(comments, draftComment, activeCommentIndex).comments
        if (!committed.length) throw new Error('请先点击图片添加评论锚点')
        if (!committed.some((comment) => comment.text.trim())) throw new Error('请至少给一个锚点填写评论文字')
        setComments(committed)
        setDraftComment(null)
        setActiveCommentIndex(null)
        await onApply({ imageIds: [imageId], sourceImageId: imageId, comments: committed })
        return
      }
      if (mode === 'grid') {
        const ids: string[] = []
        for (let row = 0; row < gridRows; row++) for (let col = 0; col < gridCols; col++) {
          const output = document.createElement('canvas')
          output.width = Math.max(1, Math.floor(image.naturalWidth / gridCols))
          output.height = Math.max(1, Math.floor(image.naturalHeight / gridRows))
          const ctx = output.getContext('2d')
          if (!ctx) throw new Error('当前浏览器不支持图片编辑')
          ctx.drawImage(image, col * output.width, row * output.height, output.width, output.height, 0, 0, output.width, output.height)
          ids.push(await storeImage(await blobToDataUrl(await canvasToBlob(output, 'image/png')), 'upload'))
        }
        await onApply({ imageIds: ids, sourceImageId: imageId })
        return
      }
      if (maskUsage) {
        const mask = document.createElement('canvas')
        mask.width = image.naturalWidth; mask.height = image.naturalHeight
        const maskContext = mask.getContext('2d')
        if (!maskContext) throw new Error('当前浏览器不支持遮罩编辑')
        maskContext.fillStyle = '#fff'; maskContext.fillRect(0, 0, mask.width, mask.height)
        maskContext.globalCompositeOperation = 'destination-out'; maskContext.lineCap = 'round'; maskContext.lineJoin = 'round'; maskContext.lineWidth = brushSize
        for (const stroke of [...strokes, currentStroke]) {
          if (!stroke.length) continue
          maskContext.beginPath(); maskContext.moveTo(stroke[0].x * mask.width, stroke[0].y * mask.height)
          for (const point of stroke.slice(1)) maskContext.lineTo(point.x * mask.width, point.y * mask.height)
          if (stroke.length === 1) maskContext.lineTo(stroke[0].x * mask.width + .1, stroke[0].y * mask.height)
          maskContext.stroke()
        }
        const maskDataUrl = await blobToDataUrl(await canvasToBlob(mask, 'image/png'))
        await onApply({ imageIds: [imageId], sourceImageId: imageId, maskDataUrl })
        return
      }
      const output = document.createElement('canvas')
      const cropRect = { x: Math.round(crop.x * image.naturalWidth), y: Math.round(crop.y * image.naturalHeight), width: Math.max(1, Math.round(crop.width * image.naturalWidth)), height: Math.max(1, Math.round(crop.height * image.naturalHeight)) }
      const width = mode === 'resize' ? Math.max(1, Math.round(image.naturalWidth * scale)) : cropRect.width
      const height = mode === 'resize' ? Math.max(1, Math.round(image.naturalHeight * scale)) : cropRect.height
      output.width = width; output.height = height
      const ctx = output.getContext('2d')
      if (!ctx) throw new Error('当前浏览器不支持图片编辑')
      ctx.drawImage(image, mode === 'resize' ? 0 : cropRect.x, mode === 'resize' ? 0 : cropRect.y, mode === 'resize' ? image.naturalWidth : cropRect.width, mode === 'resize' ? image.naturalHeight : cropRect.height, 0, 0, width, height)
      if (!maskUsage && (strokes.length || currentStroke.length)) {
        ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = brushColor; ctx.lineWidth = brushSize * (width / image.naturalWidth)
        for (const stroke of [...strokes, currentStroke]) {
          if (!stroke.length) continue
          const toOutput = (point: ImageAnnotatorPoint) => mode === 'resize'
            ? { x: point.x * width, y: point.y * height }
            : { x: ((point.x - crop.x) / crop.width) * width, y: ((point.y - crop.y) / crop.height) * height }
          const first = toOutput(stroke[0])
          ctx.beginPath(); ctx.moveTo(first.x, first.y)
          for (const point of stroke.slice(1)) { const next = toOutput(point); ctx.lineTo(next.x, next.y) }
          ctx.stroke()
        }
        ctx.restore()
      }
      const blob = await canvasToBlob(output, 'image/png')
      const nextId = await storeImage(await blobToDataUrl(blob), 'upload')
      await onApply({ imageIds: [nextId], sourceImageId: imageId })
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : '保存编辑结果失败') } finally { setSaving(false) }
  }

  const applyText = applyLabel ?? (mode === 'comment' ? '保存评论' : mode === 'grid' ? '切分为多张' : maskUsage ? '保存遮罩' : APPLY_LABEL_FALLBACK)
  const modalTitle = title ?? '标注图片'
  const toolButtonClass = (active: boolean) => `${TOOL_BUTTON_BASE} ${active ? TOOL_BUTTON_ACTIVE : TOOL_BUTTON_IDLE}`

  return createPortal(
    <div
      data-no-drag-select
      role="dialog"
      aria-modal="true"
      aria-label={modalTitle}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-2 backdrop-blur-sm sm:p-6"
      onPointerDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}
    >
      <section
        className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white text-zinc-900 shadow-2xl dark:border-white/[0.08] dark:bg-[oklch(0.227 0.004 286)] dark:text-zinc-100"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-white/[0.08] sm:px-5">
          <div>
            <strong className="block text-sm font-semibold">{modalTitle}</strong>
            <span className="mt-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">裁剪、画笔标注（可选标注/遮罩用途）、评论锚点或调整尺寸</span>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            disabled={saving}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-xl leading-none text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-40 dark:hover:bg-white/[0.08] dark:hover:text-zinc-200"
          >
            ×
          </button>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2.5 dark:border-white/[0.08] sm:px-5">
          <button type="button" className={toolButtonClass(mode === 'crop')} onClick={() => switchMode('crop')}>裁剪</button>
          <button type="button" className={toolButtonClass(mode === 'brush')} onClick={() => switchMode('brush')}>画笔</button>
          <button type="button" className={toolButtonClass(mode === 'resize')} onClick={() => switchMode('resize')}>缩放</button>
          <button type="button" className={toolButtonClass(mode === 'grid')} onClick={() => switchMode('grid')}>宫格切分</button>
          <button type="button" className={toolButtonClass(mode === 'comment')} onClick={() => switchMode('comment')}>评论锚点</button>

          {mode === 'comment' && (
            <>
              <span className="inline-flex items-center rounded-lg bg-zinc-100 px-3 py-1.5 text-[11px] text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400">
                单击图片立即添加锚点（不必先输入文字），编号即评论顺序；再次点击锚点可补写/修改
              </span>
              <button
                type="button"
                className={toolButtonClass(false)}
                onClick={() => { setComments([]); setDraftComment(null); setActiveCommentIndex(null) }}
                disabled={!comments.length}
              >
                清空锚点
              </button>
            </>
          )}

          {brushMode && (
            <>
              <span className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-white/[0.06]">
                <button type="button" className={toolButtonClass(brushUsage === 'markup')} onClick={() => switchBrushUsage('markup')}>用途：标注</button>
                <button type="button" className={toolButtonClass(brushUsage === 'mask')} onClick={() => switchBrushUsage('mask')}>用途：遮罩</button>
              </span>
              <label className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-1.5 text-[11px] text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">
                {maskUsage ? '遮罩笔刷' : '颜色'}
                {!maskUsage ? <input type="color" value={brushColor} onChange={(event) => setBrushColor(event.target.value)} className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" /> : null}
              </label>
              <input
                aria-label="笔刷大小"
                type="range"
                min="2"
                max="80"
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                className="h-1 w-28 cursor-pointer accent-blue-500"
              />
              <button type="button" className={toolButtonClass(false)} onClick={() => { setStrokes([]); setCurrentStroke([]) }}>清空</button>
            </>
          )}

          {mode === 'resize' && (
            <label className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-1.5 text-[11px] text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">
              比例
              <input type="range" min="0.1" max="2" step="0.05" value={scale} onChange={(event) => setScale(Number(event.target.value))} className="h-1 w-28 cursor-pointer accent-blue-500" />
              <span className="font-medium text-zinc-700 dark:text-zinc-200">{Math.round(scale * 100)}%</span>
            </label>
          )}

          {mode === 'grid' && (
            <>
              <label className="inline-flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                行
                <input type="number" min="1" max="6" value={gridRows} onChange={(event) => setGridRows(Math.max(1, Math.min(6, Number(event.target.value) || 1)))} className={FIELD_INPUT_CLASS} />
              </label>
              <label className="inline-flex items-center gap-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                列
                <input type="number" min="1" max="6" value={gridCols} onChange={(event) => setGridCols(Math.max(1, Math.min(6, Number(event.target.value) || 1)))} className={FIELD_INPUT_CLASS} />
              </label>
            </>
          )}
        </div>

        <div className="relative flex h-[58vh] flex-initial items-center justify-center overflow-auto p-3 sm:p-5" style={CANVAS_BG_STYLE}>
          {/* canvas 必须常驻：ref 一旦为空，加载完成时无法设置固有尺寸，会退化成 300x150 的默认画布 */}
          <div className="relative inline-block leading-none">
            <canvas
              ref={canvasRef}
              // object-fit:contain + CSS 宽高自动 => 浏览器按固有比例缩放，即便 max-width/max-height 同时生效也不变形
              className={`block h-auto max-h-[58vh] w-auto max-w-full touch-none rounded-lg object-contain shadow-lg ${hasImage ? 'cursor-crosshair' : 'cursor-default'}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
            {/* 加载/错误覆盖层：只盖画布本身，层级(z-20)低于评论输入框(z-[95])，且 pointer-events-none，
                保证「正在读取图片…」永远挡不住也不能截断输入框的焦点与点击 */}
            {(loading || error) && (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-white/80 backdrop-blur-[1px] dark:bg-[oklch(0.227 0.004 286)]/80">
                <p className={error ? 'text-xs text-red-500 dark:text-red-400' : 'text-xs text-zinc-500 dark:text-zinc-400'}>
                  {error || '正在读取图片…'}
                </p>
              </div>
            )}
            {/* 输入框走 createPortal + position: fixed：定位基准是视口，不是 wrapper 的尺寸，
                即便画布被 CSS 缩小、裁切，输入框也始终贴着锚点且不会跑出屏幕 */}
            {mode === 'comment' && draftComment && createPortal(
              <form
                ref={commentFormRef}
                className="fixed z-[95] flex max-h-[min(60vh,22rem)] w-64 flex-col gap-2 overflow-auto rounded-xl border border-zinc-200 bg-white p-3 shadow-2xl dark:border-white/[0.1] dark:bg-[oklch(0.27 0.007 286)]"
                style={{ left: 0, top: 0 }}
                onSubmit={(event) => { event.preventDefault(); saveDraftComment() }}
              >
                <label htmlFor="image-annotator-comment-input" className="text-[11px] font-semibold text-blue-500 dark:text-blue-400">
                  {activeCommentIndex !== null ? `评论 ${activeCommentIndex + 1}` : `评论 ${comments.length + 1}`}
                </label>
                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                <textarea
                  id="image-annotator-comment-input"
                  autoFocus
                  value={draftComment.text}
                  maxLength={COMMENT_TEXT_MAX_LENGTH}
                  rows={3}
                  placeholder="描述这个位置要怎么改，例如：把这个改成红色"
                  onChange={(event) => setDraftComment((previous) => previous ? { ...previous, text: event.target.value } : previous)}
                  // 失焦只写回文字、保持输入框打开（详见 saveDraftComment 的 keepOpen 说明）
                  onBlur={() => saveDraftComment(true)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); saveDraftComment() }
                    else if (event.key === 'Escape') { event.preventDefault(); cancelDraftComment() }
                  }}
                  className="min-h-[62px] w-full shrink-0 resize-y rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-800 outline-none focus:border-blue-400 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-zinc-100"
                />
                <div className="flex shrink-0 justify-end gap-2">
                  <button type="button" className={toolButtonClass(false)} onClick={activeCommentIndex !== null ? deleteComment : cancelDraftComment}>
                    {activeCommentIndex !== null ? '删除' : '取消'}
                  </button>
                  <button type="submit" className={`${TOOL_BUTTON_BASE} ${TOOL_BUTTON_ACTIVE}`}>保存</button>
                </div>
              </form>,
              document.body,
            )}
        </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-100 px-4 py-3 dark:border-white/[0.08] sm:px-5">
          <button type="button" className={`${FOOTER_BUTTON_BASE} ${FOOTER_BUTTON_IDLE}`} onClick={onClose} disabled={saving}>取消</button>
          <button
            type="button"
            className={`${FOOTER_BUTTON_BASE} ${FOOTER_BUTTON_PRIMARY}`}
            onClick={() => void apply()}
            disabled={loading || Boolean(error) || saving}
          >
            {saving ? '保存中…' : applyText}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}

export default ImageAnnotatorModal
