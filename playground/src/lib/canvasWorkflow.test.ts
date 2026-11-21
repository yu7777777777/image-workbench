import { describe, expect, it, vi } from 'vitest'
import type { CanvasNode, TaskRecord } from '../types'
import { buildCanvasInput, canConnectCanvasNodes, canvasGroupPortId, getCanvasImageId, getCanvasPromptImageRefs, normalizeCanvasProject, resolveCanvasSourceIds } from './canvasWorkflow'

vi.mock('./imageCache', () => ({ ensureImageCached: vi.fn(async (id: string) => id === 'missing' ? undefined : `data:image/png;base64,${id}`) }))
const node = (id: string, patch: Partial<CanvasNode> = {}): CanvasNode => ({ id, type: 'image', position: { x: 0, y: 0 }, width: 280, height: 300, zIndex: 1, ...patch })

describe('canvas node workflow', () => {
  it('loads the selected output image ID, including a non-first image', () => {
    const tasks = [{ id: 'task', outputImages: ['first', 'second'] }] as TaskRecord[]
    expect(getCanvasImageId(node('a', { taskId: 'task', outputIndex: 1 }), tasks)).toBe('second')
    expect(getCanvasImageId(node('a', { imageId: 'upload' }), tasks)).toBe('upload')
  })

  it('uses connected prompt nodes by default while keeping cached image references', async () => {
    const sources = [node('photo', { imageId: 'photo' }), node('same', { imageId: 'photo' }), node('text', { type: 'text', prompt: '保持产品结构' })]
    const result = await buildCanvasInput(node('gen', { type: 'generation', prompt: '换成蓝色', sourceNodeIds: ['text', 'photo', 'same'] }), sources, [])
    // 连接了图片素材时，buildCanvasInput 会补一段参考图编号图例，让“图1”有确定指向
    expect(result.prompt).toBe('保持产品结构\n\n参考图对应关系：图1：其他参考。')
    expect(result.inputImages).toEqual([{ id: 'photo', dataUrl: 'data:image/png;base64,photo' }])
    expect((await buildCanvasInput(node('gen', { type: 'generation', prompt: '换成蓝色', promptMode: 'own', sourceNodeIds: ['text'] }), sources, [])).prompt).toBe('换成蓝色')
    expect((await buildCanvasInput(node('gen', { type: 'generation', prompt: '换成蓝色', promptMode: 'combine', sourceNodeIds: ['text'] }), sources, [])).prompt).toBe('保持产品结构\n\n换成蓝色')
  })

  it('numbers reference images in submit order and expands @图N into the matching role', async () => {
    const sources = [
      node('pose', { imageId: 'pose', assetRole: 'model' }),
      node('dress', { imageId: 'dress', assetRole: 'product' }),
      node('gen2', { type: 'generation', imageId: 'gen2', assetRole: 'scene' }),
    ]
    const result = await buildCanvasInput(
      node('gen', { type: 'generation', prompt: '参考 @图1 的姿势，使用图2 的连衣裙，背景用@图 3', sourceNodeIds: ['pose', 'dress', 'gen2'] }),
      sources,
      [],
    )
    // 图片按连接顺序提交，“图N”始终指向第 N 张输入图
    expect(result.inputImages.map((image) => image.id)).toEqual(['pose', 'dress', 'gen2'])
    expect(result.prompt).toBe('请严格保留产品原素材的外观与结构，模特和场景仅作为构图、姿态与氛围参考。\n\n参考 图1（模特参考） 的姿势，使用图2（产品原素材） 的连衣裙，背景用图3（场景参考）')
    // 有明确角色时追加产品保真约束
    expect(result.prompt.startsWith('请严格保留产品原素材')).toBe(true)
  })

  it('appends a role legend for reference images the prompt never cites', async () => {
    const sources = [node('a', { imageId: 'a', assetRole: 'model' }), node('b', { imageId: 'b', assetRole: 'style' })]
    const result = await buildCanvasInput(node('gen', { prompt: '用 @图1 的姿势', sourceNodeIds: ['a', 'b'] }), sources, [])
    expect(result.prompt).toBe('请严格保留产品原素材的外观与结构，模特和场景仅作为构图、姿态与氛围参考。\n\n用 图1（模特参考） 的姿势\n\n参考图对应关系：图2：风格参考。')
    // 角色全是 other 时不追加产品保真约束
    const plain = await buildCanvasInput(node('gen', { prompt: '参考', sourceNodeIds: ['a'] }), [node('a', { imageId: 'a' })], [])
    expect(plain.prompt.startsWith('参考')).toBe(true)
  })

  it('reports the same image numbering the prompt uses', () => {
    const sources = [
      node('pose', { imageId: 'pose', assetRole: 'model' }),
      node('dup', { imageId: 'pose', assetRole: 'model' }),
      node('off', { imageId: 'off', assetEnabled: false }),
      node('text', { type: 'text', prompt: 'x' }),
    ]
    const refs = getCanvasPromptImageRefs(node('gen', { type: 'generation', sourceNodeIds: ['text', 'pose', 'dup', 'off'] }), sources, [])
    expect(refs).toEqual([{ index: 0, assetId: 'pose', role: 'model' }])
  })

  it('forwards a canvas mask attached to a connected image into the generation input', async () => {
    const result = await buildCanvasInput(
      node('gen', { type: 'generation', prompt: '编辑', sourceNodeIds: ['photo'] }),
      [node('photo', { imageId: 'photo', maskImageId: 'mask' })],
      [],
    )
    expect(result.maskDataUrl).toBe('data:image/png;base64,mask')
    expect(result.maskTargetImageId).toBe('photo')
  })

  it('rejects unavailable and unfinished references instead of silently generating without them', async () => {
    const gen = node('gen', { type: 'generation', prompt: 'edit', sourceNodeIds: ['photo'] })
    await expect(buildCanvasInput(gen, [node('photo', { imageId: 'missing' })], [])).rejects.toThrow('已丢失')
    await expect(buildCanvasInput(gen, [node('photo', { taskId: 'running' })], [{ id: 'running', status: 'running' }] as TaskRecord[])).rejects.toThrow('仍在生成')
    await expect(buildCanvasInput(gen, [], [])).rejects.toThrow('已移除')
  })

  it('rejects empty prompts and more than sixteen images', async () => {
    await expect(buildCanvasInput(node('gen', { type: 'generation' }), [], [])).rejects.toThrow('提示词')
    await expect(buildCanvasInput(node('gen', { type: 'generation', sourceNodeIds: ['text'] }), [node('text', { type: 'text', label: '提示词', prompt: '' })], [])).rejects.toThrow('提示词')
    const sources = Array.from({ length: 17 }, (_, index) => node(String(index), { imageId: String(index) }))
    await expect(buildCanvasInput(node('gen', { prompt: 'edit', sourceNodeIds: sources.map((node) => node.id) }), sources, [])).rejects.toThrow('16')
  })

  it('prevents self links, non-generator targets and cycles through several generators', () => {
    const nodes = [node('photo'), node('a', { type: 'generation', sourceNodeIds: ['photo'] }), node('b', { type: 'generation', sourceNodeIds: ['a'] })]
    expect(canConnectCanvasNodes(nodes, 'photo', 'b')).toBe(true)
    expect(canConnectCanvasNodes(nodes, 'b', 'a')).toBe(false)
    expect(canConnectCanvasNodes(nodes, 'a', 'a')).toBe(false)
    expect(canConnectCanvasNodes(nodes, 'a', 'photo')).toBe(false)
    const withOutput = [...nodes, node('output', { parentNodeId: 'b', sourceNodeIds: [] })]
    expect(canConnectCanvasNodes(withOutput, 'output', 'a')).toBe(false)
  })

  it('resolves a group output to image/text members without expanding generation targets', async () => {
    const members = [node('photo', { groupId: 'g', imageId: 'photo' }), node('text', { type: 'text', groupId: 'g', prompt: '主体' }), node('nested-gen', { type: 'generation', groupId: 'g' })]
    expect(resolveCanvasSourceIds(members, canvasGroupPortId('g'))).toEqual(['photo', 'text'])
    expect(canConnectCanvasNodes([...members, node('target', { type: 'generation' })], canvasGroupPortId('g'), 'target')).toBe(true)
    const result = await buildCanvasInput(node('target', { type: 'generation', prompt: '组合', sourceNodeIds: [canvasGroupPortId('g')] }), members, [])
    expect(result.inputImages).toHaveLength(1)
    expect(result.prompt).toContain('主体')
  })

  it('restores the default project, keeps empty deletion state and normalizes invalid imported geometry', () => {
    expect(normalizeCanvasProject({ id: 'legacy-name', name: '旧画布', nodes: [] })?.id).toBe('legacy-name')
    expect(normalizeCanvasProject({ name: '旧画布', nodes: [] })?.id).toBe('default')
    expect(normalizeCanvasProject({ nodes: [] })?.nodes).toEqual([])
    const project = normalizeCanvasProject({ nodes: [node('a', { width: -1, position: { x: NaN, y: 3 }, sourceNodeIds: ['missing', 'a'] }), node('a')], viewTransform: { scale: 0, x: NaN } })!
    expect(project.nodes).toHaveLength(1)
    expect(project.nodes[0].position).toEqual({ x: 0, y: 3 })
    expect(project.nodes[0].sourceNodeIds).toEqual([])
    expect(project.nodes[0].width).toBe(160)
    expect(project.viewTransform).toEqual({ x: 0, y: 0, scale: 0.05 })
    expect(normalizeCanvasProject({ nodes: 'invalid' })).toBeNull()
  })

  it('preserves optional group membership when importing a canvas project', () => {
    const project = normalizeCanvasProject({ nodes: [node('a', { groupId: 'group-1', groupName: '参考图', groupCollapsed: true, promptMode: 'combine' }), node('b', { groupId: 'group-1' })] })!
    expect(project.nodes.map((item) => item.groupId)).toEqual(['group-1', 'group-1'])
    expect(project.nodes[0].groupName).toBe('参考图')
    expect(project.nodes[0].groupCollapsed).toBe(true)
    expect(project.nodes[0].promptMode).toBe('combine')
  })
})
