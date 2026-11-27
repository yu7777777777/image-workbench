import type { TaskRecord } from '../types'
import { hasImageDimensions, parseRatio } from './size'

export interface ImageDimensions {
  width: number
  height: number
}

/**
 * 瀑布流单卡宽高比下限（宽 / 高）：
 * 1 / 2.2 ≈ 0.4545，允许 2:3、9:16、1:2 竖图完整展示，
 * 同时对 1:3 / 1:4 等超长详情图设置温和高度上限，防止单列被无限拉长。
 */
export const MASONRY_MIN_ASPECT_RATIO = 1 / 2.2
/** 瀑布流单卡宽高比上限（宽 / 高）：完整容纳 16:9 与 21:9 横图，防止超宽条带过扁。 */
export const MASONRY_MAX_ASPECT_RATIO = 2.4
/** 非完成态（生成中 / 失败）卡片宽高比保护范围，保证状态提示与重试按钮有充足空间。 */
export const MASONRY_NON_DONE_MIN_ASPECT_RATIO = 0.65
export const MASONRY_NON_DONE_MAX_ASPECT_RATIO = 1.35
/** 无尺寸元数据时的默认宽高比。 */
export const MASONRY_FALLBACK_ASPECT_RATIO = 1
/**
 * 列高差容差（px）：当多列底部高度几乎齐平时优先选择更靠左的列，
 * 避免 1~8px 像素取整差异打乱同排作品从左到右的时间阅读顺序。
 */
export const MASONRY_COLUMN_TIE_TOLERANCE = 8

export interface ResolvedTaskAspect {
  rawAspectRatio: number
  aspectRatio: number
  isHeightCapped: boolean
  isWidthCapped: boolean
}

export interface MasonryItemLayout {
  id: string
  index: number
  column: number
  left: number
  top: number
  width: number
  height: number
  right: number
  bottom: number
  aspectRatio: number
  rawAspectRatio: number
  isHeightCapped: boolean
  isWidthCapped: boolean
}

export interface MasonryLayoutResult {
  items: MasonryItemLayout[]
  itemById: Map<string, MasonryItemLayout>
  totalHeight: number
  columnWidth: number
  columnHeights: number[]
}

const PIXEL_SIZE_PATTERN = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/

/** 解析任务参数中的像素尺寸或比例字符串为宽高比（width / height）。 */
export function parseSizeAspectRatio(size: string | undefined): number | null {
  if (!size) return null
  const trimmed = size.trim()
  if (!trimmed || trimmed.toLowerCase() === 'auto') return null

  const pixelMatch = trimmed.match(PIXEL_SIZE_PATTERN)
  if (pixelMatch) {
    const width = Number(pixelMatch[1])
    const height = Number(pixelMatch[2])
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return width / height
    }
    return null
  }

  const parsedRatio = parseRatio(trimmed)
  if (parsedRatio) {
    return parsedRatio.width / parsedRatio.height
  }
  return null
}

/**
 * 推导单张任务卡片在瀑布流中的目标宽高比与裁切标记。
 * 优先级：实测封面尺寸（done 任务） > 实际生效尺寸 > 请求尺寸 > 1:1 兜底。
 */
export function resolveTaskMasonryAspect(
  task: Pick<TaskRecord, 'status' | 'outputImages' | 'params' | 'actualParams' | 'actualParamsByImage'>,
  measuredDims?: ImageDimensions | null,
): ResolvedTaskAspect {
  const coverImageId = task.outputImages?.[0]
  let rawAspectRatio: number | null = null

  if (task.status === 'done' && hasImageDimensions(measuredDims)) {
    rawAspectRatio = measuredDims.width / measuredDims.height
  }

  if (rawAspectRatio == null && coverImageId) {
    rawAspectRatio = parseSizeAspectRatio(task.actualParamsByImage?.[coverImageId]?.size)
  }
  if (rawAspectRatio == null) {
    rawAspectRatio = parseSizeAspectRatio(task.actualParams?.size)
  }
  if (rawAspectRatio == null) {
    rawAspectRatio = parseSizeAspectRatio(task.params?.size)
  }
  if (rawAspectRatio == null || !Number.isFinite(rawAspectRatio) || rawAspectRatio <= 0) {
    rawAspectRatio = MASONRY_FALLBACK_ASPECT_RATIO
  }

  if (task.status !== 'done') {
    const aspectRatio = Math.min(
      MASONRY_NON_DONE_MAX_ASPECT_RATIO,
      Math.max(MASONRY_NON_DONE_MIN_ASPECT_RATIO, rawAspectRatio),
    )
    return {
      rawAspectRatio,
      aspectRatio,
      isHeightCapped: false,
      isWidthCapped: false,
    }
  }

  const isHeightCapped = rawAspectRatio < MASONRY_MIN_ASPECT_RATIO - 1e-4
  const isWidthCapped = rawAspectRatio > MASONRY_MAX_ASPECT_RATIO + 1e-4
  const aspectRatio = Math.min(
    MASONRY_MAX_ASPECT_RATIO,
    Math.max(MASONRY_MIN_ASPECT_RATIO, rawAspectRatio),
  )

  return {
    rawAspectRatio,
    aspectRatio,
    isHeightCapped,
    isWidthCapped,
  }
}

/**
 * 计算按时间顺序尽量对照的等宽瀑布流坐标：
 * - 第一排严格从左到右放入最新作品；
 * - 后续卡片每次放入当前最矮的列（在极小容差内优先最左列），
 *   因此纵向上新作品始终不晚于旧作品出现，且各列底部均衡、无大块留白。
 */
export function computeMasonryLayout(
  tasks: Array<Pick<TaskRecord, 'id' | 'status' | 'outputImages' | 'params' | 'actualParams' | 'actualParamsByImage'>>,
  options: {
    containerWidth: number
    columns: number
    gap: number
    dimensionsByImageId?: ReadonlyMap<string, ImageDimensions>
    tieTolerance?: number
  },
): MasonryLayoutResult {
  const columns = Math.max(1, Math.floor(options.columns))
  const gap = Math.max(0, options.gap)
  const containerWidth = Math.max(0, options.containerWidth)
  const tieTolerance = Math.max(0, options.tieTolerance ?? MASONRY_COLUMN_TIE_TOLERANCE)
  const columnWidth = containerWidth > 0 ? Math.max(0, (containerWidth - gap * (columns - 1)) / columns) : 0

  const columnHeights = new Array<number>(columns).fill(0)
  const items: MasonryItemLayout[] = []
  const itemById = new Map<string, MasonryItemLayout>()

  if (columnWidth <= 0 || tasks.length === 0) {
    return {
      items,
      itemById,
      totalHeight: 0,
      columnWidth,
      columnHeights,
    }
  }

  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index]
    const coverImageId = task.outputImages?.[0]
    const measuredDims = coverImageId ? options.dimensionsByImageId?.get(coverImageId) : undefined
    const resolved = resolveTaskMasonryAspect(task, measuredDims)

    let minHeight = columnHeights[0]
    for (let col = 1; col < columns; col++) {
      if (columnHeights[col] < minHeight) {
        minHeight = columnHeights[col]
      }
    }

    let targetColumn = 0
    for (let col = 0; col < columns; col++) {
      if (columnHeights[col] <= minHeight + tieTolerance) {
        targetColumn = col
        break
      }
    }

    const left = targetColumn * (columnWidth + gap)
    const top = columnHeights[targetColumn]
    const height = Math.max(1, Math.round(columnWidth / resolved.aspectRatio))
    const right = left + columnWidth
    const bottom = top + height

    const item: MasonryItemLayout = {
      id: task.id,
      index,
      column: targetColumn,
      left,
      top,
      width: columnWidth,
      height,
      right,
      bottom,
      aspectRatio: resolved.aspectRatio,
      rawAspectRatio: resolved.rawAspectRatio,
      isHeightCapped: resolved.isHeightCapped,
      isWidthCapped: resolved.isWidthCapped,
    }

    items.push(item)
    itemById.set(task.id, item)
    columnHeights[targetColumn] = bottom + gap
  }

  let totalHeight = 0
  for (let col = 0; col < columns; col++) {
    if (columnHeights[col] > 0) {
      totalHeight = Math.max(totalHeight, columnHeights[col] - gap)
    }
  }

  return {
    items,
    itemById,
    totalHeight,
    columnWidth,
    columnHeights,
  }
}

/** 筛选位于当前视口（含上下缓冲区）内的瀑布流卡片。 */
export function getVisibleMasonryItems(
  items: readonly MasonryItemLayout[],
  viewportTop: number,
  viewportBottom: number,
  overscanPx: number,
): MasonryItemLayout[] {
  const minY = viewportTop - overscanPx
  const maxY = viewportBottom + overscanPx
  return items.filter((item) => item.bottom >= minY && item.top <= maxY)
}
