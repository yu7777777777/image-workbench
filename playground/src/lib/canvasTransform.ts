/**
 * 表示一个二维坐标点
 */
export interface Point {
  x: number
  y: number
}

/**
 * 表示一个二维尺寸
 */
export interface Size {
  width: number
  height: number
}

/**
 * 画布的视口变换状态
 */
export interface CanvasTransform {
  scale: number
  x: number
  y: number
}

export const CANVAS_MIN_SCALE = 0.05
export const CANVAS_MAX_SCALE = 5
export const CANVAS_DEFAULT_GRID_SIZE = 20

/**
 * 将缩放比约束在最小和最大缩放范围之间
 * @param scale 期望的缩放比
 * @returns 约束后的缩放比
 */
export function clampCanvasScale(scale: number): number {
  return Math.min(CANVAS_MAX_SCALE, Math.max(CANVAS_MIN_SCALE, scale))
}

/**
 * 以屏幕上的指定点为中心进行缩放
 * @param transform 当前的画布变换
 * @param screenPoint 屏幕坐标点
 * @param nextScale 目标缩放比
 * @returns 新的画布变换状态
 */
export function zoomAtScreenPoint(
  transform: CanvasTransform,
  screenPoint: Point,
  nextScale: number
): CanvasTransform {
  const worldPoint = {
    x: (screenPoint.x - transform.x) / transform.scale,
    y: (screenPoint.y - transform.y) / transform.scale,
  }
  const scale = clampCanvasScale(nextScale)

  return {
    scale,
    x: screenPoint.x - worldPoint.x * scale,
    y: screenPoint.y - worldPoint.y * scale,
  }
}

/**
 * 基于滚轮增量计算缩放并应用变换
 * @param transform 当前的画布变换
 * @param screenPoint 屏幕坐标点（鼠标位置）
 * @param delta 滚轮滚动量 deltaY
 * @returns 新的画布变换状态
 */
export function zoomByDelta(
  transform: CanvasTransform,
  screenPoint: Point,
  delta: number
): CanvasTransform {
  const zoomFactor = Math.exp(-delta * 0.002)
  return zoomAtScreenPoint(transform, screenPoint, transform.scale * zoomFactor)
}

/**
 * 将屏幕坐标转换为世界坐标
 * @param screenPoint 屏幕坐标点
 * @param transform 当前的画布变换
 * @returns 世界坐标点
 */
export function screenToWorld(screenPoint: Point, transform: CanvasTransform): Point {
  return {
    x: (screenPoint.x - transform.x) / transform.scale,
    y: (screenPoint.y - transform.y) / transform.scale,
  }
}

/**
 * 将世界坐标转换为屏幕坐标
 * @param worldPoint 世界坐标点
 * @param transform 当前的画布变换
 * @returns 屏幕坐标点
 */
export function worldToScreen(worldPoint: Point, transform: CanvasTransform): Point {
  return {
    x: worldPoint.x * transform.scale + transform.x,
    y: worldPoint.y * transform.scale + transform.y,
  }
}

/**
 * 基于双指缩放手势计算新的画布变换
 * @param input 包含起始变换、手势起始与当前中心点、手势起始与当前距离的对象
 * @returns 新的画布变换状态
 */
export function getPinchTransform(input: {
  startTransform: CanvasTransform
  startCentroid: Point
  nextCentroid: Point
  startDistance: number
  nextDistance: number
}): CanvasTransform {
  const worldPoint = {
    x: (input.startCentroid.x - input.startTransform.x) / input.startTransform.scale,
    y: (input.startCentroid.y - input.startTransform.y) / input.startTransform.scale,
  }
  const distanceRatio = input.startDistance > 0 ? input.nextDistance / input.startDistance : 1
  const scale = clampCanvasScale(input.startTransform.scale * distanceRatio)

  return {
    scale,
    x: input.nextCentroid.x - worldPoint.x * scale,
    y: input.nextCentroid.y - worldPoint.y * scale,
  }
}

/**
 * 计算让指定矩形居中并自适应视口的画布变换
 * @param rect 要适应的矩形区域
 * @param viewportSize 视口的尺寸
 * @param padding 矩形周围的留白（可选，默认0）
 * @returns 新的画布变换状态
 */
export function fitToRect(
  rect: { x: number; y: number; width: number; height: number },
  viewportSize: Size,
  padding: number = 0
): CanvasTransform {
  const scaleX = viewportSize.width / (rect.width + 2 * padding)
  const scaleY = viewportSize.height / (rect.height + 2 * padding)
  const scale = clampCanvasScale(Math.min(scaleX, scaleY))

  const x = (viewportSize.width - rect.width * scale) / 2 - rect.x * scale
  const y = (viewportSize.height - rect.height * scale) / 2 - rect.y * scale

  return { scale, x, y }
}

/**
 * 根据当前缩放比计算网格绘制所需的间距和透明度
 * @param scale 当前的画布缩放比
 * @param baseGridSize 基础网格大小（可选，默认值为常量）
 * @returns 包含渲染使用的 spacing 和 opacity
 */
export function getGridSpacing(
  scale: number,
  baseGridSize: number = CANVAS_DEFAULT_GRID_SIZE
): { spacing: number; opacity: number } {
  let spacing = baseGridSize * scale

  while (spacing > 0 && spacing < 8) {
    spacing *= 2
  }

  let opacity = spacing / 20
  opacity = Math.max(0.15, Math.min(0.5, opacity))

  return { spacing, opacity }
}
