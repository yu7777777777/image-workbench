import type { TaskRecord } from '../types'
import { getActualRatioAndResolution, getDerivedParamsFromSize } from './size'

/** 参与"请求值 vs 实际值"对比的三项展示参数。 */
export interface ImageActualParams {
  size?: string
  aspect_ratio?: string
  resolution?: string
}

/**
 * 请求侧参数：比例/分辨率从请求的 size 派生
 * （本地 TaskParams 未单独存这两项，请求值统一从这里推导）。
 */
export function getImageRequestedParams(task: TaskRecord): ImageActualParams {
  return { size: task.params.size, ...getDerivedParamsFromSize(task.params.size) }
}

/** 实际出图参数：尺寸/比例/分辨率一律以图片真实像素为准。 */
export function getImageActualParams(task: TaskRecord, width: number, height: number): ImageActualParams {
  return {
    size: `${width}x${height}`,
    ...getActualRatioAndResolution(task.params.size, width, height),
  }
}
