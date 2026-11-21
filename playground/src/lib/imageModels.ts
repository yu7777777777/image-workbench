import type { ApiProfile } from '../types'
import { isPoolProfileId } from './poolProfileIds'

export const DEFAULT_IMAGES_MODEL = 'gpt-image-2.5-sunburst'

export function getImageGenerationModel(profile: ApiProfile) {
  // 本站账号池是「用哪个模型出图」的选择器：模型就是账号池 profile 自己的 model 字段，
  // 不能读 imageGenerationModel（那里固定是 gpt-image-2，会让下拉框里选的模型不生效）。
  if (isPoolProfileId(profile.id)) return profile.model
  return profile.provider === 'openai' && profile.apiMode === 'responses'
    ? profile.imageGenerationModel?.trim() ?? ''
    : profile.model
}

export function isGptImage25Model(model: string) {
  return model.trim().toLowerCase().includes('gpt-image-2.5')
}
