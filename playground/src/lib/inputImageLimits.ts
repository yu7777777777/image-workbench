import type { ApiProfile, AppSettings } from '../types'

/**
 * 应用层参考图数量上限。
 * 当前上游后端没有静态数量限制（按账号动态 429），本地沿用统一的 16 张应用上限；
 * 这里保留按模型扩展的结构，后续模型能力差异出现时在此按 profile/model 细分。
 */
export const DEFAULT_INPUT_IMAGE_LIMIT = 16

export function getInputImageLimit(_profile?: ApiProfile, _settings?: AppSettings): number {
  return DEFAULT_INPUT_IMAGE_LIMIT
}

/** 提交拦截的错误文案。 */
export function getInputImageLimitError(limit: number = getInputImageLimit()): string {
  return `参考图数量超过上限（${limit} 张），请移除超限图片或切换模型后提交`
}

/** 超限置灰图片的常驻提示文案。 */
export function getInputImageLimitHint(limit: number = getInputImageLimit()): string {
  return `超出当前模型的 ${limit} 张参考图上限，请移除超限图片或切换模型后提交`
}
