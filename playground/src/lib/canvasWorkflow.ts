import type { CanvasAssetRole, CanvasNode, CanvasProject, ImageAnchorComment, InputImage, TaskRecord } from '../types'
import { ensureImageCached } from './imageCache'

export const CANVAS_PROJECT_ID = 'default'
/** 单次编辑请求携带的锚点评论上限，与后端校验保持一致 */
export const MAX_CANVAS_ANCHOR_COMMENTS = 20
export const canvasGroupPortId = (groupId: string): string => `canvas-group-output-${groupId}`

/** Default node size per type. Generation nodes hold a lot of controls, so they
 * need more vertical room than images or plain prompt nodes. */
export const CANVAS_NODE_DEFAULTS: Record<CanvasNode['type'], { width: number; height: number }> = {
  task: { width: 280, height: 280 },
  image: { width: 280, height: 280 },
  text: { width: 280, height: 280 },
  generation: { width: 340, height: 450 },
}

/** Minimum height a generation node must have for its controls to fit. */
export const CANVAS_GENERATION_MIN_HEIGHT = 445

/** Minimum height when a generation node has connected prompt-mode controls. */
export const CANVAS_GENERATION_CONNECTED_MIN_HEIGHT = 485

/** 提示词节点也要装得下文本框 + 模板库/对话/润色三行。 */
export const CANVAS_TEXT_MIN_HEIGHT = 280

/** Minimum width kept for every node, mirroring the normalizer's lower bound. */
const CANVAS_NODE_MIN_WIDTH = 160

/** Resolves the default size for a node type while keeping the legacy 280 fallback. */
export function canvasNodeDefaultSize(type: CanvasNode['type']): { width: number; height: number } {
  return CANVAS_NODE_DEFAULTS[type] ?? { width: 280, height: 280 }
}

/**
 * 为通过工具栏/素材库新建的节点计算不与已有节点原点重叠的位置，
 * 避免连续新增节点直接堆叠在同一坐标上。
 */
export function findNonOverlappingCanvasPosition(
  base: { x: number; y: number },
  nodes: Pick<CanvasNode, 'position'>[],
  options: { stepX?: number; stepY?: number; threshold?: number; maxAttempts?: number } = {},
): { x: number; y: number } {
  const stepX = options.stepX ?? 44
  const stepY = options.stepY ?? 36
  const threshold = options.threshold ?? 28
  const maxAttempts = options.maxAttempts ?? 24

  const isOccupied = (candidate: { x: number; y: number }) =>
    nodes.some((node) =>
      Math.abs(node.position.x - candidate.x) < threshold
      && Math.abs(node.position.y - candidate.y) < threshold,
    )

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const column = Math.floor(attempt / 6)
    const row = attempt % 6
    const candidate = {
      x: base.x + row * stepX + column * 60,
      y: base.y + row * stepY,
    }
    if (!isOccupied(candidate)) return candidate
  }

  return { x: base.x + stepX, y: base.y + stepY }
}

export function getCanvasGroupMembers(nodes: CanvasNode[], groupId: string): CanvasNode[] {
  return nodes.filter((item) => item.groupId === groupId)
}

/** Resolve a node or a group output port into safe, real source nodes. */
export function resolveCanvasSourceIds(nodes: CanvasNode[], sourceId: string): string[] {
  const prefix = 'canvas-group-output-'
  if (!sourceId.startsWith(prefix)) return nodes.some((item) => item.id === sourceId) ? [sourceId] : []
  const groupId = sourceId.slice(prefix.length)
  return getCanvasGroupMembers(nodes, groupId)
    .filter((item) => item.type !== 'generation')
    .map((item) => item.id)
}

export function getCanvasImageId(node: CanvasNode, tasks: TaskRecord[]): string | undefined {
  return node.imageId || tasks.find((task) => task.id === node.taskId)?.outputImages[node.outputIndex ?? 0]
}

/** 素材角色的中文标签，提示词编号说明与节点下拉共用。 */
export const CANVAS_ASSET_ROLE_LABELS: Record<CanvasAssetRole, string> = {
  product: '产品原素材',
  model: '模特参考',
  scene: '场景参考',
  other: '其他参考',
  style: '风格参考',
  lighting: '光线参考',
  composition: '构图参考',
}

export interface CanvasPromptImageRef {
  /** 输入图片在本次请求中的下标，从 0 开始；提示词里展示为“图N”。 */
  index: number
  assetId: string
  role: CanvasAssetRole
}

/**
 * 生成节点实际会提交的图片顺序，与 buildCanvasInput 的 inputImages 保持一致。
 * 提示词里的“@图N”和节点角标都以此编号，避免用户写的图1、图2 与真实输入错位。
 */
export function getCanvasPromptImageRefs(node: CanvasNode, nodes: CanvasNode[], tasks: TaskRecord[]): CanvasPromptImageRef[] {
  const refs: CanvasPromptImageRef[] = []
  const expandedSourceIds = (node.sourceNodeIds ?? []).flatMap((sourceId) => resolveCanvasSourceIds(nodes, sourceId))
  for (const sourceId of new Set(expandedSourceIds)) {
    const source = nodes.find((item) => item.id === sourceId)
    if (!source || source.type === 'text' || source.assetEnabled === false) continue
    const imageId = getCanvasImageId(source, tasks)
    if (!imageId && !source.imageUrl) continue
    const assetId = imageId || source.id
    if (refs.some((ref) => ref.assetId === assetId)) continue
    refs.push({ index: refs.length, assetId, role: source.assetRole || 'other' })
  }
  return refs
}

/**
 * 把提示词里的“@图N”展开成模型能看懂的说明。
 * 图片本身不带顺序语义，这里按实际提交顺序写入每张图的角色，
 * 未带 @ 的编号则追加在图例里兜底。
 */
export function expandCanvasPromptImageRefs(prompt: string, refs: CanvasPromptImageRef[]): string {
  if (!refs.length) return prompt
  const cited = new Set<number>()
  const expanded = prompt.replace(/@?\s*[图圖](?:片)?\s*(\d{1,2})/g, (match, digits: string) => {
    const index = Number(digits) - 1
    const ref = refs[index]
    if (!ref) return match
    cited.add(index)
    return `图${index + 1}（${CANVAS_ASSET_ROLE_LABELS[ref.role]}）`
  })
  const uncited = refs.filter((ref) => !cited.has(ref.index))
  if (!uncited.length) return expanded
  const legend = uncited.map((ref) => `图${ref.index + 1}：${CANVAS_ASSET_ROLE_LABELS[ref.role]}`).join('；')
  return `${expanded}\n\n参考图对应关系：${legend}。`
}

export function canConnectCanvasNodes(nodes: CanvasNode[], sourceId: string, targetId: string): boolean {
  const target = nodes.find((node) => node.id === targetId)
  const sourceIds = resolveCanvasSourceIds(nodes, sourceId)
  if (!target || target.type !== 'generation' || !sourceIds.length || sourceIds.includes(targetId)) return false
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (id === targetId) return true
    if (visited.has(id)) return false
    visited.add(id)
    const source = nodes.find((node) => node.id === id)
    return [...(source?.sourceNodeIds ?? []), ...(source?.parentNodeId ? [source.parentNodeId] : [])].some(visit)
  }
  return sourceIds.every((id) => !visit(id))
}

export async function buildCanvasInput(node: CanvasNode, nodes: CanvasNode[], tasks: TaskRecord[]): Promise<{ prompt: string; inputImages: InputImage[]; comments?: ImageAnchorComment[]; maskDataUrl?: string; maskTargetImageId?: string }> {
  const connectedPrompts: string[] = []
  const inputImages: InputImage[] = []
  const assetRoles: Record<string, CanvasAssetRole> = {}
  let hasConnectedText = false
  let maskDataUrl: string | undefined
  let maskTargetImageId: string | undefined
  const expandedSourceIds = [...new Set((node.sourceNodeIds ?? []).flatMap((sourceId) => {
    // A group connection is represented by its port or a member node. Expand
    // only image-capable members; never pull the target generation node itself.
    const resolved = resolveCanvasSourceIds(nodes, sourceId)
    if (!resolved.length) throw new Error('连接的素材已移除，请重新连接。')
    return resolved.filter((id) => id !== node.id)
  }))]
  for (const sourceId of expandedSourceIds) {
    const source = nodes.find((item) => item.id === sourceId)
    if (!source) continue
    if (source.type === 'text') {
      hasConnectedText = true
      const prompt = (source.prompt ?? source.label ?? '').trim()
      if (prompt) connectedPrompts.push(prompt)
      continue
    }
    if (source.assetEnabled === false) continue
    const sourceTask = tasks.find((task) => task.id === source.taskId)
    if (sourceTask?.status === 'running') throw new Error('上游节点仍在生成，请完成后再执行。')
    const imageId = getCanvasImageId(source, tasks)
    const dataUrl = imageId ? await ensureImageCached(imageId) : source.imageUrl
    if (!dataUrl) throw new Error('参考图片尚未生成或已丢失，请重新导入。')
    // 旧画布独立 URL 由已有 API 图片解析器处理；新上传图片均使用持久化 ID。
    const id = imageId || source.id
    if (!inputImages.some((image) => image.id === id)) inputImages.push({ id, dataUrl })
    assetRoles[id] = source.assetRole || 'other'
    if (!maskDataUrl && source.maskImageId) {
      maskDataUrl = await ensureImageCached(source.maskImageId)
      if (maskDataUrl) maskTargetImageId = source.maskTargetImageId || id
    }
  }
  // 锚点评论来自两个入口：图片编辑器把评论写在节点自身；上游节点累积的评论随之流出。
  // 评论的 image_index 指向输入图片顺序，因此这里按 inputImages 重算，避免评论与图片错位。
  const comments: ImageAnchorComment[] = []
  for (const source of [node, ...expandedSourceIds.map((id) => nodes.find((item) => item.id === id))]) {
    if (!source?.comments?.length) continue
    const sourceImageIndex = source === node ? 0 : inputImages.findIndex((image) => image.id === (getCanvasImageId(source, tasks) || source.id))
    for (const comment of source.comments) {
      if (comments.length >= MAX_CANVAS_ANCHOR_COMMENTS) break
      const index = sourceImageIndex >= 0 ? sourceImageIndex : Math.max(0, Math.min(inputImages.length - 1, comment.image_index))
      comments.push({ ...comment, image_index: inputImages.length ? index : comment.image_index })
    }
  }
  const promptMode = hasConnectedText ? node.promptMode ?? 'connected' : 'own'
  const prompts = [
    ...(promptMode === 'own' ? [] : connectedPrompts),
    ...(promptMode === 'connected' || !node.prompt?.trim() ? [] : [node.prompt.trim()]),
  ]
  if (!prompts.length && !comments.length) throw new Error('请填写提示词，或连接一个提示词节点，或在图片编辑器中添加评论锚点。')
  if (inputImages.length > 16) throw new Error('参考图片最多 16 张，请减少连接。')
  // 图片按提交顺序编号为“图1、图2…”，提示词里的 @图N 会展开成对应素材角色，
  // 未被引用的图补一句图例，避免模型分不清用户说的图1是哪一张。
  const imageRefs = inputImages.map((image, index) => ({
    index,
    assetId: image.id,
    role: assetRoles[image.id] || 'other',
  }))
  const hasRoleHint = imageRefs.some((ref) => ref.role !== 'other')
  const mergedPrompt = [...new Set(prompts.map((prompt) => expandCanvasPromptImageRefs(prompt, imageRefs)))].join('\n\n')
  const guard = hasRoleHint ? '请严格保留产品原素材的外观与结构，模特和场景仅作为构图、姿态与氛围参考。\n\n' : ''
  return { prompt: `${guard}${mergedPrompt}`, inputImages, ...(comments.length ? { comments } : {}), ...(maskDataUrl ? { maskDataUrl, maskTargetImageId } : {}) }
}

export function normalizeCanvasProject(value: unknown): CanvasProject | null {
  if (!value || typeof value !== 'object') return null
  const project = value as Record<string, unknown>
  if (!Array.isArray(project.nodes)) return null
  const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const ids = new Set<string>()
  const nodes: CanvasNode[] = []
  for (const value of project.nodes) {
    if (!value || typeof value !== 'object') continue
    const raw = value as Record<string, unknown>
    if (typeof raw.id !== 'string' || ids.has(raw.id) || !['task', 'image', 'text', 'generation'].includes(String(raw.type))) continue
    ids.add(raw.id)
    const position = raw.position && typeof raw.position === 'object' ? raw.position as Record<string, unknown> : {}
    const type = raw.type as CanvasNode['type']
    const defaults = canvasNodeDefaultSize(type)
    const width = Math.max(CANVAS_NODE_MIN_WIDTH, finite(raw.width, defaults.width))
    const storedHeight = Math.max(120, finite(raw.height, defaults.height))
    // Legacy projects saved 280px for every node, which cropped generation controls.
    // Raise only undersized generation nodes; larger user-resized nodes stay as-is.
    const height = type === 'generation'
      ? Math.max(storedHeight, CANVAS_GENERATION_MIN_HEIGHT)
      : type === 'text' ? Math.max(storedHeight, CANVAS_TEXT_MIN_HEIGHT) : storedHeight
    nodes.push({
      id: raw.id, type,
      position: { x: finite(position.x, 0), y: finite(position.y, 0) },
      width, height,
      zIndex: finite(raw.zIndex, nodes.length + 1), locked: raw.locked === true,
      ...(typeof raw.groupId === 'string' ? { groupId: raw.groupId } : {}),
      ...(typeof raw.groupName === 'string' ? { groupName: raw.groupName } : {}),
      ...(raw.groupCollapsed === true ? { groupCollapsed: true } : {}),
      ...(Array.isArray(raw.comments) ? { comments: normalizeCanvasComments(raw.comments) } : {}),
      ...(typeof raw.maskImageId === 'string' ? { maskImageId: raw.maskImageId } : {}),
      ...(typeof raw.maskTargetImageId === 'string' ? { maskTargetImageId: raw.maskTargetImageId } : {}),
      ...(typeof raw.taskId === 'string' ? { taskId: raw.taskId } : {}),
      ...(typeof raw.imageId === 'string' ? { imageId: raw.imageId } : {}),
      ...(['product', 'model', 'scene', 'other', 'style', 'lighting', 'composition'].includes(String(raw.assetRole)) ? { assetRole: raw.assetRole as CanvasAssetRole } : {}),
      ...(typeof raw.imageUrl === 'string' ? { imageUrl: raw.imageUrl } : {}),
      ...(typeof raw.assetEnabled === 'boolean' ? { assetEnabled: raw.assetEnabled } : {}),
      ...(typeof raw.label === 'string' ? { label: raw.label } : {}),
      ...(typeof raw.prompt === 'string' ? { prompt: raw.prompt } : {}),
      ...(['connected', 'own', 'combine'].includes(String(raw.promptMode)) ? { promptMode: raw.promptMode as CanvasNode['promptMode'] } : {}),
      ...(typeof raw.profileId === 'string' ? { profileId: raw.profileId } : {}),
      ...(typeof raw.parentNodeId === 'string' ? { parentNodeId: raw.parentNodeId } : {}),
      ...(typeof raw.completedTaskId === 'string' ? { completedTaskId: raw.completedTaskId } : {}),
      outputIndex: Math.max(0, Math.floor(finite(raw.outputIndex, 0))),
      sourceNodeIds: Array.isArray(raw.sourceNodeIds) ? raw.sourceNodeIds.filter((id): id is string => typeof id === 'string') : [],
      params: normalizeCanvasParams(raw.params),
    })
  }
  nodes.forEach((node) => {
    node.sourceNodeIds = node.sourceNodeIds?.filter((id) => {
      if (ids.has(id) && id !== node.id) return true
      const prefix = 'canvas-group-output-'
      return id.startsWith(prefix) && nodes.some((member) => member.groupId === id.slice(prefix.length) && member.id !== node.id)
    }).map((id) => {
      const source = nodes.find((item) => item.id === id)
      return source?.groupId && source.groupName?.startsWith('素材组') ? canvasGroupPortId(source.groupId) : id
    }).filter((id, index, values) => values.indexOf(id) === index)
  })
  const view = project.viewTransform && typeof project.viewTransform === 'object' ? project.viewTransform as Record<string, unknown> : {}
  return {
    // 旧版本只保存 default；新版本保留每个工程自己的 ID，避免恢复时互相覆盖。
    id: typeof project.id === 'string' && project.id.trim() ? project.id : CANVAS_PROJECT_ID,
    name: typeof project.name === 'string' ? project.name : '未命名画布', nodes,
    viewTransform: { x: finite(view.x, 0), y: finite(view.y, 0), scale: Math.min(5, Math.max(0.05, finite(view.scale, 1))) },
    createdAt: finite(project.createdAt, Date.now()), updatedAt: finite(project.updatedAt, Date.now()),
  }
}

/** 归一化持久化的锚点评论，过滤掉损坏字段，最多保留 MAX_CANVAS_ANCHOR_COMMENTS 条。 */
function normalizeCanvasComments(value: unknown[]): ImageAnchorComment[] {
  const comments: ImageAnchorComment[] = []
  for (const item of value) {
    if (comments.length >= MAX_CANVAS_ANCHOR_COMMENTS) break
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const text = typeof raw.text === 'string' ? raw.text.trim() : ''
    const x = typeof raw.x === 'number' ? raw.x : Number.NaN
    const y = typeof raw.y === 'number' ? raw.y : Number.NaN
    if (!text || !Number.isFinite(x) || !Number.isFinite(y)) continue
    comments.push({
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
      text: text.slice(0, 2000),
      image_index: typeof raw.image_index === 'number' && Number.isFinite(raw.image_index) ? Math.max(0, Math.floor(raw.image_index)) : 0,
    })
  }
  return comments
}

function normalizeCanvasParams(value: unknown): CanvasNode['params'] {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  return {
    ...(typeof raw.size === 'string' ? { size: raw.size } : {}),
    ...(['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(raw.quality)) ? { quality: raw.quality as NonNullable<CanvasNode['params']>['quality'] } : {}),
    ...(['png', 'jpeg', 'webp'].includes(String(raw.output_format)) ? { output_format: raw.output_format as NonNullable<CanvasNode['params']>['output_format'] } : {}),
    ...(typeof raw.n === 'number' && Number.isFinite(raw.n) ? { n: Math.max(1, Math.min(10, Math.floor(raw.n))) } : {}),
  }
}
