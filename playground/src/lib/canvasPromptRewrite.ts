import type { ApiProfile, AppSettings } from '../types'
import { callAgentPromptRewriteApi, sanitizeRewrittenPrompt } from './agentApi'

/** Extra instructions prepended to every canvas prompt rewrite request. */
export const CANVAS_REWRITE_GUARD = '严格只输出最终提示词正文，禁止输出任何思考、说明、过渡语或元描述（不要出现“正在整理”“以下是”“好的”等字样，不要复述本指令）。'

const REWRITE_RULES = [
  '你是专业的图像生成提示词编辑器，不是聊天助手。请把“原始描述”改写成可以直接交给生图模型执行的中文提示词。',
  '先在心里判断内容类型，再按类型补全信息：人物写清外貌、服装、动作、情绪和镜头；动物写清物种特征、毛发、姿态和神态；产品写清外观、材质、结构和展示方式；建筑或风景写清空间层次、天气、时间和视角；插画、概念艺术或海报写清媒介、画风、造型、色彩和版式。',
  '所有类型都要根据原意补充主体、动作或状态、构图与视角、环境、光线、色彩、质感、细节和画面质量，并加入适合该内容的简短负面约束。',
  '保留原文明确的信息，不虚构品牌、人物身份、文字内容、功能或故事背景；没有指定的部分使用自然、稳妥的默认值。',
  '不要把“生成图片”“提示词”等元话术写进结果，不要强行使用商品摄影术语。',
  '输出一段连贯、具体、有画面感的中文提示词，通常 150 至 300 字，复杂场景可更长；只输出结果，不要标题、解释、引号、Markdown 或分点。',
].join('\n')

/** Builds the full rewrite instruction sent to the text model. */
export function buildCanvasRewritePrompt(original: string): string {
  return `${CANVAS_REWRITE_GUARD}\n\n${REWRITE_RULES}\n\n原始描述：\n${original}`
}

export interface RewriteCanvasPromptOptions {
  settings: AppSettings
  profile: ApiProfile
  prompt: string
  signal?: AbortSignal
}

/**
 * Rewrites a canvas prompt through the clean text channel and always returns a
 * sanitized, ready-to-use prompt. Throws with a user-facing message when the model
 * only produced process narration.
 */
export async function rewriteCanvasPrompt(opts: RewriteCanvasPromptOptions): Promise<string> {
  const { settings, profile, prompt, signal } = opts
  const text = await callAgentPromptRewriteApi({ settings, profile, prompt: buildCanvasRewritePrompt(prompt), signal })
  return sanitizeRewrittenPrompt(text)
}
