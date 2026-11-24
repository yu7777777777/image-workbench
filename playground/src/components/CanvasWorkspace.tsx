import { useCallback, useEffect, useRef, useState } from 'react'
import { createInputImageFromFile, submitTask, useStore } from '../store'
import type { CanvasNode, CanvasProject } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { getImage, storeImage } from '../lib/db'
import { ensureImageCached } from '../lib/imageCache'
import { downloadImageIds } from '../lib/downloadImages'
import { buildCanvasInput, canConnectCanvasNodes, canvasGroupPortId, getCanvasImageId, normalizeCanvasProject } from '../lib/canvasWorkflow'
import { rewriteCanvasPrompt } from '../lib/canvasPromptRewrite'
import { fitToRect, getPinchTransform, screenToWorld, zoomAtScreenPoint, zoomByDelta } from '../lib/canvasTransform'
import { isPoolBuild } from '../lib/accountPool'
import { getAgentTextApiProfile, isAgentTextApiProfile } from '../lib/apiProfiles'
import { callAgentResponsesApi } from '../lib/agentApi'
import { useCanvasProject } from '../hooks/useCanvasProject'
import { CanvasNodeCard } from './canvas/CanvasNodeCard'
import { CanvasToolbar } from './canvas/CanvasToolbar'
import { CanvasLibrary } from './canvas/CanvasLibrary'
import { CanvasPromptLibrary } from './canvas/CanvasPromptLibrary'
import { CanvasIcon } from './canvas/CanvasIcon'
import { CanvasMiniMap } from './canvas/CanvasMiniMap'
import { CanvasImageEditorModal } from './canvas/CanvasImageEditorModal'
import type { CanvasImageEditResult } from './canvas/CanvasImageEditorModal'
import { createLocalId } from '../lib/id'
import { isPresetConfigOnlyEnabled, isPresetProfile } from '../lib/presetConfig'
import './canvas/canvas.css'

type Point = { x: number; y: number }
type Gesture = { kind: 'pan' | 'drag' | 'group-drag' | 'resize' | 'box' | 'connect'; start: Point; positions?: Array<{ id: string; position: Point }>; resizeNodeId?: string; resizeWidth?: number; resizeHeight?: number; sourceId?: string; origin: Point; moved: boolean }
const editable = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable="true"]'))
const snapshotCanvasNodes = (nodes: CanvasNode[]): CanvasNode[] => nodes.map((node) => {
  // 持久化图片已经由 imageId 指向 IndexedDB；撤销快照不再重复持有同一份
  // data URL。没有 imageId 的旧版外链/临时节点仍保留 URL，确保撤销可恢复。
  const { imageUrl, ...rest } = node
  return {
    ...rest,
    ...(node.imageId || !imageUrl ? {} : { imageUrl }),
    position: { ...node.position },
    sourceNodeIds: node.sourceNodeIds ? [...node.sourceNodeIds] : undefined,
    params: node.params ? { ...node.params } : undefined,
  }
})

export default function CanvasWorkspace() {
  const viewport = useRef<HTMLDivElement>(null)
  const uploadInput = useRef<HTMLInputElement>(null)
  const projectInput = useRef<HTMLInputElement>(null)
  const nodes = useStore((state) => state.canvasNodes)
  const tasks = useStore((state) => state.tasks)
  const settings = useStore((state) => state.settings)
  const selected = useStore((state) => state.canvasSelectedNodeIds)
  const transform = useStore((state) => state.canvasTransform)
  const showGrid = useStore((state) => state.canvasShowGrid)
  const projectName = useStore((state) => state.canvasProjectName)
  const { loaded, status, save, load, projects, activeProjectId, switchProject, createProject, renameProject, removeProject } = useCanvasProject()
  const [tool, setTool] = useState<'select' | 'hand'>('select')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false)
  const [promptLibraryTarget, setPromptLibraryTarget] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [box, setBox] = useState<{ from: Point; to: Point } | null>(null)
  const [connection, setConnection] = useState<{ sourceId: string; point: Point } | null>(null)
  const [menu, setMenu] = useState<{ nodeId?: string; x: number; y: number; point: Point } | null>(null)
  const [busy, setBusy] = useState<string[]>([])
  const [promptRewriteBusy, setPromptRewriteBusy] = useState<string[]>([])
  const [imageEditor, setImageEditor] = useState<{ nodeId: string; imageId: string } | null>(null)
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
  const submitting = useRef(new Set<string>())
  const clipboard = useRef<CanvasNode[]>([])
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<{ transform: typeof transform; centroid: Point; distance: number } | null>(null)
  const space = useRef(false)
  const suppressGroupClick = useRef(false)
  const history = useRef<{ undo: CanvasNode[][]; redo: CanvasNode[][] }>({ undo: [], redo: [] })
  const [, refreshHistory] = useState(0)
  useEffect(() => {
    history.current = { undo: [], redo: [] }
    refreshHistory((value) => value + 1)
  }, [activeProjectId])

  const checkpoint = useCallback(() => {
    history.current.undo.push(snapshotCanvasNodes(useStore.getState().canvasNodes))
    if (history.current.undo.length > 40) history.current.undo.shift()
    history.current.redo = []
    refreshHistory((value) => value + 1)
  }, [])
  const undo = useCallback((redo = false) => {
    const from = redo ? history.current.redo : history.current.undo
    const to = redo ? history.current.undo : history.current.redo
    const previous = from.pop()
    if (!previous) return
    to.push(snapshotCanvasNodes(useStore.getState().canvasNodes))
    useStore.setState({ canvasNodes: previous, canvasSelectedNodeIds: [] })
    refreshHistory((value) => value + 1)
  }, [])
  const screenPoint = (client: Point): Point => {
    const rect = viewport.current!.getBoundingClientRect()
    return { x: client.x - rect.left, y: client.y - rect.top }
  }
  const centerPoint = (): Point => {
    const element = viewport.current
    return screenToWorld({ x: (element?.clientWidth ?? 1000) / 2 - (libraryOpen ? 130 : 0), y: (element?.clientHeight ?? 700) / 2 }, useStore.getState().canvasTransform)
  }

  const duplicateNodes = (sourceNodes: CanvasNode[], offset = 40) => {
    if (!sourceNodes.length) return
    checkpoint()
    const state = useStore.getState()
    const remap = new Map(sourceNodes.map((node) => [node.id, createLocalId('canvas-copy')]))
    const groupRemap = new Map<string, string>()
    const copies = sourceNodes.map((node) => {
      const id = remap.get(node.id)!
      const groupId = node.groupId ? (groupRemap.get(node.groupId) || (() => { const next = createLocalId('canvas-group'); groupRemap.set(node.groupId!, next); return next })()) : undefined
      return {
        ...structuredClone(node), id, groupId,
        position: { x: node.position.x + offset, y: node.position.y + offset },
        sourceNodeIds: node.sourceNodeIds?.map((sourceId) => remap.get(sourceId)).filter((value): value is string => Boolean(value)),
        parentNodeId: node.parentNodeId ? remap.get(node.parentNodeId) : undefined,
        taskId: node.type === 'generation' ? undefined : node.taskId,
        completedTaskId: undefined,
        zIndex: Math.max(0, ...state.canvasNodes.map((item) => item.zIndex)) + 1,
      }
    })
    useStore.setState((current) => ({ canvasNodes: [...current.canvasNodes, ...copies], canvasSelectedNodeIds: copies.map((node) => node.id) }))
  }

  const groupSelected = () => {
    const state = useStore.getState()
    const ids = state.canvasSelectedNodeIds
    if (ids.length < 2) { state.showToast('至少选择两个节点才能分组', 'info'); return }
    const groupName = window.prompt('给分组命名', '新分组')?.trim()
    if (!groupName) return
    checkpoint()
    const groupId = createLocalId('canvas-group')
    useStore.setState((current) => ({ canvasNodes: current.canvasNodes.map((node) => ids.includes(node.id) ? { ...node, groupId, groupName, groupCollapsed: false } : node) }))
  }

  const ungroupSelected = () => {
    const state = useStore.getState()
    const groups = new Set(state.canvasNodes.filter((node) => state.canvasSelectedNodeIds.includes(node.id)).map((node) => node.groupId).filter((id): id is string => Boolean(id)))
    if (!groups.size) return
    checkpoint()
    useStore.setState((current) => ({ canvasNodes: current.canvasNodes.map((node) => node.groupId && groups.has(node.groupId) ? { ...node, groupId: undefined } : node) }))
  }

  const duplicateSelected = () => {
    const state = useStore.getState()
    duplicateNodes(state.canvasNodes.filter((node) => state.canvasSelectedNodeIds.includes(node.id)))
  }

  const toggleSelectedLocked = () => {
    const state = useStore.getState()
    const targets = state.canvasNodes.filter((node) => state.canvasSelectedNodeIds.includes(node.id))
    if (!targets.length) return
    const nextLocked = targets.some((node) => !node.locked)
    checkpoint()
    useStore.setState((current) => ({ canvasNodes: current.canvasNodes.map((node) => state.canvasSelectedNodeIds.includes(node.id) ? { ...node, locked: nextLocked } : node) }))
  }

  const renameSelectedGroup = () => {
    const state = useStore.getState()
    const groupIds = new Set(state.canvasNodes.filter((node) => state.canvasSelectedNodeIds.includes(node.id) && node.groupId).map((node) => node.groupId).filter((id): id is string => Boolean(id)))
    if (groupIds.size !== 1) return
    const currentName = state.canvasNodes.find((node) => node.groupId && groupIds.has(node.groupId))?.groupName || '未命名分组'
    const nextName = window.prompt('重命名分组', currentName)?.trim()
    if (!nextName || nextName === currentName) return
    checkpoint()
    useStore.setState((current) => ({ canvasNodes: current.canvasNodes.map((node) => node.groupId && groupIds.has(node.groupId) ? { ...node, groupName: nextName } : node) }))
  }

  const toggleGroup = (groupId: string) => {
    const state = useStore.getState()
    const members = state.canvasNodes.filter((node) => node.groupId === groupId)
    if (!members.length) return
    const nextCollapsed = !members.every((node) => node.groupCollapsed)
    checkpoint()
    useStore.setState((current) => ({
      canvasNodes: current.canvasNodes.map((node) => node.groupId === groupId ? { ...node, groupCollapsed: nextCollapsed } : node),
      canvasSelectedNodeIds: nextCollapsed ? [] : current.canvasSelectedNodeIds,
    }))
  }

  const toggleSelectedGroups = () => {
    const state = useStore.getState()
    const groupIds = Array.from(new Set(state.canvasNodes
      .filter((node) => state.canvasSelectedNodeIds.includes(node.id) && node.groupId)
      .map((node) => node.groupId)
      .filter((id): id is string => Boolean(id))))
    if (!groupIds.length) return
    const members = state.canvasNodes.filter((node) => node.groupId && groupIds.includes(node.groupId))
    const nextCollapsed = members.some((node) => !node.groupCollapsed)
    checkpoint()
    useStore.setState((current) => ({
      canvasNodes: current.canvasNodes.map((node) => node.groupId && groupIds.includes(node.groupId) ? { ...node, groupCollapsed: nextCollapsed } : node),
      canvasSelectedNodeIds: nextCollapsed ? [] : current.canvasSelectedNodeIds,
    }))
    state.showToast(nextCollapsed ? `已折叠 ${groupIds.length} 个分组` : `已展开 ${groupIds.length} 个分组`, 'success')
  }

  const groupPointerDown = (event: React.PointerEvent, groupId: string) => {
    if (!loaded || event.button !== 0 || tool === 'hand') return
    event.preventDefault()
    event.stopPropagation()
    suppressGroupClick.current = false
    const state = useStore.getState()
    const members = state.canvasNodes.filter((node) => node.groupId === groupId)
    state.setCanvasSelectedNodeIds(members.map((node) => node.id))
    gesture.current = {
      kind: 'group-drag', start: { x: event.clientX, y: event.clientY }, origin: { x: event.clientX, y: event.clientY }, moved: false,
      positions: members.filter((node) => !node.locked).map((node) => ({ id: node.id, position: { ...node.position } })),
    }
    viewport.current?.setPointerCapture(event.pointerId)
  }

  const resizePointerDown = (event: React.PointerEvent, nodeId: string) => {
    if (!loaded || event.button !== 0 || tool === 'hand') return
    const node = useStore.getState().canvasNodes.find((item) => item.id === nodeId)
    if (!node || node.locked) return
    event.preventDefault()
    event.stopPropagation()
    setMenu(null)
    useStore.getState().setCanvasSelectedNodeIds([nodeId])
    gesture.current = {
      kind: 'resize', start: { x: event.clientX, y: event.clientY }, origin: { x: event.clientX, y: event.clientY }, moved: false,
      resizeNodeId: nodeId, resizeWidth: node.width, resizeHeight: node.height,
    }
    viewport.current?.setPointerCapture(event.pointerId)
  }

  const addNode = (type: CanvasNode['type'], point?: Point, sourceIds?: string[]) => {
    checkpoint()
    const state = useStore.getState()
    const generation = type === 'generation'
    const position = point || centerPoint()
    const selectedSources = sourceIds ?? state.canvasSelectedNodeIds.filter((id) => state.canvasNodes.some((node) => node.id === id))
    const canvasProfileId = state.settings.profiles.find((profile) => profile.id === state.settings.activeProfileId && !isAgentTextApiProfile(profile))?.id
      ?? state.settings.profiles.find((profile) => !isAgentTextApiProfile(profile))?.id
    const node: CanvasNode = {
      id: createLocalId('canvas'), type, label: generation ? 'API 生成' : type === 'text' ? '提示词' : '图片',
      position: { x: position.x - 150, y: position.y - 140 }, width: generation ? 320 : 280, height: generation ? 400 : type === 'text' ? 280 : 300,
      zIndex: Math.max(0, ...state.canvasNodes.map((node) => node.zIndex)) + 1,
      ...(generation ? { prompt: '', sourceNodeIds: selectedSources, params: { size: '1254x1254', quality: 'auto', n: 1 }, profileId: canvasProfileId } : {}),
    }
    state.addCanvasNode(node)
    state.setCanvasSelectedNodeIds([node.id])
    setMenu(null)
    return node.id
  }

  const addPromptFromLibrary = (prompt: string) => {
    const id = promptLibraryTarget || addNode('text')
    useStore.getState().updateCanvasNode(id, { label: '提示词', prompt })
    setPromptLibraryOpen(false)
    setPromptLibraryTarget(null)
  }

  const importFiles = async (files: File[], point?: Point) => {
    const images = files.filter((file) => file.type.startsWith('image/'))
    if (!images.length) { useStore.getState().showToast('请选择图片文件', 'error'); return }
    checkpoint()
    const position = point || centerPoint()
    // 多张图片一次拖入时自动建立素材组；组框会随成员节点自动计算尺寸，
    // 后续只需把生成节点与组内任一节点建立输入关系即可复用整组素材。
    const autoGroupId = images.length > 1 ? createLocalId('canvas-group') : undefined
    const autoGroupName = images.length > 1 ? `素材组 · ${images.length} 张` : undefined
    const imported: CanvasNode[] = []
    for (const [index, file] of images.entries()) {
      try {
        const image = await createInputImageFromFile(file)
        if (!image) continue
        const stored = await getImage(image.id)
        const imageHeight = stored?.width && stored.height ? Math.min(420, Math.max(150, 280 * stored.height / stored.width)) : 230
        const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(images.length))))
        imported.push({ id: createLocalId('canvas-image'), type: 'image', imageId: image.id, label: file.name, position: { x: position.x - 140 + (index % columns) * 310, y: position.y - 140 + Math.floor(index / columns) * (imageHeight + 90) }, width: 280, height: imageHeight + 70, zIndex: Date.now() + index, ...(autoGroupId ? { groupId: autoGroupId, groupName: autoGroupName } : {}) })
      } catch (error) { useStore.getState().showToast(error instanceof Error ? error.message : '图片导入失败', 'error') }
    }
    useStore.setState((state) => ({ canvasNodes: [...state.canvasNodes, ...imported], canvasSelectedNodeIds: imported.map((node) => node.id) }))
  }

  const addHistoryImage = (taskId: string, imageId: string, outputIndex: number) => {
    checkpoint()
    const position = centerPoint()
    const id = createLocalId('canvas-history')
    useStore.getState().addCanvasNode({ id, type: 'task', taskId, imageId, outputIndex, label: '历史图片', position: { x: position.x - 140, y: position.y - 140 }, width: 280, height: 300, zIndex: Date.now() })
    useStore.getState().setCanvasSelectedNodeIds([id])
  }

  const runNode = async (nodeId: string) => {
    const state = useStore.getState()
    const node = state.canvasNodes.find((node) => node.id === nodeId)
    if (!node || node.type !== 'generation' || submitting.current.has(nodeId) || state.tasks.some((task) => task.id === node.taskId && task.status === 'running')) return
    submitting.current.add(nodeId)
    setBusy([...submitting.current])
    try {
      // buildCanvasInput 会把节点自身与上游节点的评论锚点合并进 input.comments，
      // 由 submitTask 落到任务上，executeTask 再透传给 CallApiOptions.comments
      const input = await buildCanvasInput(node, state.canvasNodes, state.tasks)
      const requestedProfile = state.settings.profiles.find((profile) => profile.id === node.profileId)
      const usableProfileId = requestedProfile && !isAgentTextApiProfile(requestedProfile)
        ? requestedProfile.id
        : state.settings.profiles.find((profile) => !isAgentTextApiProfile(profile))?.id
      const profileId = isPresetConfigOnlyEnabled() && !isPresetProfile(usableProfileId ?? '')
        ? state.settings.profiles.find((profile) => isPresetProfile(profile.id) && !isAgentTextApiProfile(profile))?.id
        : usableProfileId
      const taskId = await submitTask({ input: { ...input, params: { ...DEFAULT_PARAMS, ...node.params }, profileId } })
      if (taskId) useStore.getState().updateCanvasNode(nodeId, { taskId })
    } catch (error) { state.showToast(error instanceof Error ? error.message : '生成失败', 'error') }
    finally { submitting.current.delete(nodeId); setBusy([...submitting.current]) }
  }

  // 一次任务可有多张输出，每张都是独立可引用的节点；刷新后也能恢复未完成任务的结果。
  useEffect(() => {
    for (const node of nodes) {
      if (node.type !== 'generation' || !node.taskId || node.completedTaskId === node.taskId) continue
      const task = tasks.find((task) => task.id === node.taskId)
      if (!task || task.status === 'running' || !task.outputImages.length) continue
      const outputs: CanvasNode[] = task.outputImages.map((imageId, index) => ({
        id: `canvas-output-${node.id}-${task.id}-${index}`, type: 'task', imageId, taskId: task.id, outputIndex: index,
        parentNodeId: node.id, label: `输出 ${index + 1}`, width: 280, height: 300,
        position: { x: node.position.x + node.width + 90 + (index % 3) * 315, y: node.position.y + Math.floor(index / 3) * 340 }, zIndex: Date.now() + index,
      }))
      useStore.setState((state) => ({ canvasNodes: [...state.canvasNodes.map((item) => item.id === node.id ? { ...item, completedTaskId: task.id } : item), ...outputs.filter((output) => !state.canvasNodes.some((item) => item.id === output.id))] }))
    }
  }, [nodes, tasks])

  const download = async (nodeId: string) => {
    const state = useStore.getState()
    const node = state.canvasNodes.find((node) => node.id === nodeId)
    if (!node) return
    const imageId = getCanvasImageId(node, state.tasks)
    if (imageId) {
      const result = await downloadImageIds([imageId], node.label || '画布图片')
      if (result.failCount) state.showToast('图片下载失败', 'error')
    } else if (node.imageUrl) {
      const link = document.createElement('a'); link.href = node.imageUrl; link.download = '画布图片.png'; link.click()
    }
  }
  const edit = (nodeId: string) => {
    const currentNodes = useStore.getState().canvasNodes
    const source = currentNodes.find((node) => node.id === nodeId)
    if (source) addNode('generation', { x: Math.max(...currentNodes.map((node) => node.position.x + node.width)) + 240, y: source.position.y + 140 }, [nodeId])
  }
  const preview = (nodeId: string) => {
    const state = useStore.getState()
    const node = state.canvasNodes.find((node) => node.id === nodeId)
    if (!node || node.type === 'generation' || node.type === 'text') return
    const imageId = getCanvasImageId(node, state.tasks)
    if (imageId) state.setLightboxImageId(imageId)
    else if (node.imageUrl) window.open(node.imageUrl, '_blank', 'noopener,noreferrer')
  }

  const connect = (sourceId: string, targetId: string) => {
    const state = useStore.getState()
    const groupId = sourceId.startsWith('canvas-group-output-') ? sourceId.slice('canvas-group-output-'.length) : undefined
    const groupMembers = groupId ? state.canvasNodes.filter((node) => node.groupId === groupId && node.type !== 'generation') : []
    if (groupMembers.length) {
      if (!canConnectCanvasNodes(state.canvasNodes, sourceId, targetId)) { state.showToast('不能连接到自身或形成循环', 'error'); return }
      const target = state.canvasNodes.find((node) => node.id === targetId)!
      const ids = [...new Set([...(target.sourceNodeIds || []), sourceId])]
      checkpoint(); state.updateCanvasNode(targetId, { sourceNodeIds: ids }); return
    }
    if (!canConnectCanvasNodes(state.canvasNodes, sourceId, targetId)) { state.showToast('不能连接到自身或形成循环', 'error'); return }
    const target = state.canvasNodes.find((node) => node.id === targetId)!
    if (target.sourceNodeIds?.includes(sourceId)) return
    checkpoint()
    state.updateCanvasNode(targetId, { sourceNodeIds: [...(target.sourceNodeIds || []), sourceId] })
  }

  const pointerDown = (event: React.PointerEvent, nodeId?: string) => {
    if (!loaded || (event.target as Element).closest('[data-canvas-ui]')) return
    setMenu(null)
    const state = useStore.getState()
    const point = { x: event.clientX, y: event.clientY }
    if (event.pointerType === 'touch') pointers.current.set(event.pointerId, point)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { transform: state.canvasTransform, centroid: screenPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), distance: Math.hypot(a.x - b.x, a.y - b.y) }
      gesture.current = null; setBox(null)
      viewport.current?.setPointerCapture(event.pointerId)
      return
    }
    const pan = event.button === 1 || (event.button === 0 && (space.current || tool === 'hand')) || (event.pointerType === 'touch' && !nodeId)
    if (!pan && (event.target as Element).closest('button,input,textarea,select,[contenteditable]')) return
    if (event.button !== 0 && !pan) return
    // 不能在这里 preventDefault，也不能一按下就 setPointerCapture：
    // 前者会吞掉后续 dblclick；后者会让第二次 pointerdown 被重定向到 viewport，
    // dblclick 的目标随之变成 viewport，节点上的双击放大同样收不到事件。
    // 因此捕获指针推迟到真正开始拖动 / 平移时（见 startCapture 与 pointerMove 的 capture）。
    event.stopPropagation()
    const startCapture = () => viewport.current?.setPointerCapture(event.pointerId)
    if (pan) {
      startCapture()
      gesture.current = { kind: 'pan', start: point, origin: point, moved: false }
      return
    }
    if (nodeId) {
      let ids = state.canvasSelectedNodeIds
      if (event.shiftKey || event.ctrlKey || event.metaKey) ids = ids.includes(nodeId) ? ids.filter((id) => id !== nodeId) : [...ids, nodeId]
      else if (!ids.includes(nodeId)) ids = [nodeId]
      const groupedIds = new Set(state.canvasNodes.filter((node) => ids.includes(node.id) && node.groupId).map((node) => node.groupId))
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey && groupedIds.size) ids = state.canvasNodes.filter((node) => node.groupId && groupedIds.has(node.groupId)).map((node) => node.id)
      state.setCanvasSelectedNodeIds(ids)
      gesture.current = { kind: 'drag', start: point, origin: point, moved: false, positions: state.canvasNodes.filter((node) => ids.includes(node.id) && !node.locked).map((node) => ({ id: node.id, position: { ...node.position } })) }
    } else {
      state.setCanvasSelectedNodeIds([])
      const from = screenPoint(point)
      gesture.current = { kind: 'box', start: from, origin: point, moved: false }
      setBox({ from, to: from })
    }
  }

  const pointerMove = (event: React.PointerEvent) => {
    const point = { x: event.clientX, y: event.clientY }
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, point)
    const state = useStore.getState()
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      state.setCanvasTransform(getPinchTransform({ startTransform: pinch.current.transform, startCentroid: pinch.current.centroid, startDistance: pinch.current.distance, nextCentroid: screenPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), nextDistance: Math.hypot(a.x - b.x, a.y - b.y) }))
      return
    }
    const active = gesture.current
    if (!active) return
    // 超过拖拽阈值才捕获指针，单击 / 双击期间保持事件落在节点上。
    const capture = () => { if (viewport.current && !viewport.current.hasPointerCapture(event.pointerId)) viewport.current.setPointerCapture(event.pointerId) }
    if (active.kind === 'connect') { setConnection({ sourceId: active.sourceId!, point: screenToWorld(screenPoint(point), state.canvasTransform) }); return }
    if (active.kind === 'pan') {
      state.setCanvasTransform({ ...state.canvasTransform, x: state.canvasTransform.x + point.x - active.start.x, y: state.canvasTransform.y + point.y - active.start.y }); active.start = point
    } else if (active.kind === 'resize') {
      if (!active.moved && Math.hypot(point.x - active.origin.x, point.y - active.origin.y) < 3) return
      if (!active.moved) { capture(); checkpoint(); active.moved = true }
      const node = state.canvasNodes.find((item) => item.id === active.resizeNodeId)
      if (!node) return
      const minWidth = node.type === 'generation' ? 300 : node.type === 'text' ? 220 : 180
      const minHeight = node.type === 'generation' ? 340 : node.type === 'text' ? 170 : 180
      const width = Math.max(minWidth, Math.min(1200, (active.resizeWidth ?? node.width) + (point.x - active.start.x) / state.canvasTransform.scale))
      const height = Math.max(minHeight, Math.min(1000, (active.resizeHeight ?? node.height) + (point.y - active.start.y) / state.canvasTransform.scale))
      useStore.getState().updateCanvasNode(node.id, { width, height })
    } else if (active.kind === 'drag' || active.kind === 'group-drag') {
      if (!active.moved && Math.hypot(point.x - active.origin.x, point.y - active.origin.y) < 3) return
      if (!active.moved) { capture(); checkpoint(); active.moved = true; if (active.kind === 'group-drag') suppressGroupClick.current = true }
      const dx = (point.x - active.start.x) / state.canvasTransform.scale, dy = (point.y - active.start.y) / state.canvasTransform.scale
      useStore.setState({ canvasNodes: state.canvasNodes.map((node) => {
        const origin = active.positions?.find((position) => position.id === node.id)
        return origin ? { ...node, position: { x: origin.position.x + dx, y: origin.position.y + dy } } : node
      }) })
    } else {
      capture()
      const to = screenPoint(point)
      setBox({ from: active.start, to })
      const a = screenToWorld({ x: Math.min(active.start.x, to.x), y: Math.min(active.start.y, to.y) }, state.canvasTransform)
      const b = screenToWorld({ x: Math.max(active.start.x, to.x), y: Math.max(active.start.y, to.y) }, state.canvasTransform)
      state.setCanvasSelectedNodeIds(state.canvasNodes.filter((node) => node.position.x < b.x && node.position.x + node.width > a.x && node.position.y < b.y && node.position.y + node.height > a.y).map((node) => node.id))
    }
  }

  const pointerUp = (event: React.PointerEvent) => {
    if (gesture.current?.kind === 'connect' && event.type !== 'pointercancel') {
      const targetId = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-canvas-input]')?.dataset.canvasInput
      if (targetId) connect(gesture.current.sourceId!, targetId)
    }
    pointers.current.delete(event.pointerId); pinch.current = null; gesture.current = null
    setBox(null); setConnection(null)
    if (viewport.current?.hasPointerCapture(event.pointerId)) viewport.current.releasePointerCapture(event.pointerId)
  }

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('[data-canvas-ui],input,textarea,select')) return
      event.preventDefault()
      const state = useStore.getState()
      state.setCanvasTransform(zoomByDelta(state.canvasTransform, screenPoint({ x: event.clientX, y: event.clientY }), event.deltaY))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])

  const removeSelected = useCallback(() => {
    const state = useStore.getState()
    const ids = state.canvasSelectedNodeIds.filter((id) => !state.canvasNodes.find((node) => node.id === id)?.locked)
    if (!ids.length) return
    checkpoint(); state.removeCanvasNodes(ids); setMenu(null)
  }, [checkpoint])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (editable(event.target) || !loaded) return
      const state = useStore.getState()
      const modifier = event.ctrlKey || event.metaKey
      if (event.code === 'Space' && event.target instanceof Element && event.target.closest('button, [data-canvas-ui]')) return
      if (event.code === 'Space') { event.preventDefault(); space.current = true }
      else if (modifier && event.key.toLowerCase() === 'c' && state.canvasSelectedNodeIds.length) { event.preventDefault(); clipboard.current = structuredClone(state.canvasNodes.filter((node) => state.canvasSelectedNodeIds.includes(node.id))); state.showToast(`已复制 ${clipboard.current.length} 个节点`, 'success') }
      else if (modifier && event.key.toLowerCase() === 'v' && clipboard.current.length) { event.preventDefault(); duplicateNodes(clipboard.current) }
      else if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(event.shiftKey) }
      else if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); undo(true) }
      else if (modifier && event.key.toLowerCase() === 'a') { event.preventDefault(); state.setCanvasSelectedNodeIds(state.canvasNodes.map((node) => node.id)) }
      else if (modifier && event.shiftKey && event.key.toLowerCase() === 'g') { event.preventDefault(); toggleSelectedGroups() }
      else if (modifier && event.key.toLowerCase() === 'g') { event.preventDefault(); groupSelected() }
      else if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); void save() }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected() }
      else if (event.key.toLowerCase() === 'f') focusSelected()
      else if (event.key === '?' || (event.shiftKey && event.key === '/')) { event.preventDefault(); setShortcutHelpOpen((open) => !open) }
      else if (event.key.toLowerCase() === 'v') setTool('select')
      else if (event.key.toLowerCase() === 'h') setTool('hand')
      else if (event.key === 'Escape') { setMenu(null); setConnection(null); gesture.current = null; state.setCanvasSelectedNodeIds([]) }
    }
    const release = () => { space.current = false }
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') release() }
    const paste = (event: ClipboardEvent) => {
      if (editable(event.target) || !loaded) return
      const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'))
      if (files.length) { event.preventDefault(); void importFiles(files) }
    }
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', release); window.addEventListener('paste', paste)
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', release); window.removeEventListener('paste', paste) }
  }, [loaded, undo, save, removeSelected, libraryOpen])

  const collapsedGroupIds = new Set(nodes.filter((node) => node.groupId && node.groupCollapsed).map((node) => node.groupId))
  const visibleNodeIds = new Set(nodes.filter((node) => !node.groupCollapsed).map((node) => node.id))
  const overviewNodes = [
    ...nodes.filter((node) => !node.groupCollapsed),
    ...Array.from(collapsedGroupIds).map((groupId) => {
      const members = nodes.filter((node) => node.groupId === groupId)
      const first = members[0]
      if (!first) return null
      const x = Math.min(...members.map((node) => node.position.x)) - 18
      const y = Math.min(...members.map((node) => node.position.y)) - 34
      return { ...first, id: `canvas-overview-${groupId}`, position: { x, y }, width: 210, height: 62 }
    }).filter((node): node is CanvasNode => Boolean(node)),
  ]

  const fit = () => {
    const state = useStore.getState()
    const element = viewport.current
    if (!element || !overviewNodes.length) return
    const x = Math.min(...overviewNodes.map((node) => node.position.x)), y = Math.min(...overviewNodes.map((node) => node.position.y))
    const width = Math.max(...overviewNodes.map((node) => node.position.x + node.width)) - x, height = Math.max(...overviewNodes.map((node) => node.position.y + node.height)) - y
    const availableWidth = element.clientWidth - (libraryOpen ? 300 : 0) - 80
    const next = fitToRect({ x, y, width, height }, { width: Math.max(200, availableWidth), height: Math.max(200, element.clientHeight - 180) }, 80)
    state.setCanvasTransform({ ...next, x: next.x + 70, y: next.y + 85 })
  }
  const focusSelected = () => {
    const state = useStore.getState()
    const targets = state.canvasNodes.filter((node) => state.canvasSelectedNodeIds.includes(node.id))
    if (!targets.length) { state.showToast('请先选择要聚焦的节点', 'info'); return }
    const x = Math.min(...targets.map((node) => node.position.x)), y = Math.min(...targets.map((node) => node.position.y))
    const right = Math.max(...targets.map((node) => node.position.x + node.width)), bottom = Math.max(...targets.map((node) => node.position.y + node.height))
    const element = viewport.current
    if (!element) return
    const scale = Math.min(1.35, Math.max(.35, Math.min((element.clientWidth - 180) / Math.max(1, right - x), (element.clientHeight - 180) / Math.max(1, bottom - y))))
    state.setCanvasTransform({ scale, x: element.clientWidth / 2 - ((x + right) / 2) * scale, y: element.clientHeight / 2 - ((y + bottom) / 2) * scale })
  }
  const arrange = () => {
    const state = useStore.getState()
    const ids = state.canvasSelectedNodeIds.length ? state.canvasSelectedNodeIds : state.canvasNodes.map((node) => node.id)
    if (!ids.length) return
    checkpoint()
    const selected = state.canvasNodes.filter((node) => ids.includes(node.id))
    const selectedIds = new Set(ids)
    const layers = new Map<string, number>()
    const visiting = new Set<string>()
    const layerFor = (node: CanvasNode): number => {
      if (layers.has(node.id)) return layers.get(node.id)!
      if (visiting.has(node.id)) return 0
      visiting.add(node.id)
      const parents = [...(node.sourceNodeIds ?? []), ...(node.parentNodeId ? [node.parentNodeId] : [])]
        .map((id) => state.canvasNodes.find((item) => item.id === id)).filter((item): item is CanvasNode => Boolean(item && selectedIds.has(item.id)))
      const layer = parents.length ? Math.max(...parents.map(layerFor)) + 1 : 0
      visiting.delete(node.id); layers.set(node.id, layer); return layer
    }
    selected.forEach(layerFor)
    const columns = new Map<number, CanvasNode[]>()
    selected.forEach((node) => { const list = columns.get(layers.get(node.id) ?? 0) ?? []; list.push(node); columns.set(layers.get(node.id) ?? 0, list) })
    const origin = centerPoint()
    const columnOffsets = new Map<number, Map<string, number>>()
    columns.forEach((column, layer) => {
      const gap = 32
      const totalHeight = column.reduce((sum, node) => sum + node.height, 0) + Math.max(0, column.length - 1) * gap
      let top = origin.y - totalHeight / 2
      const offsets = new Map<string, number>()
      column.forEach((node) => { offsets.set(node.id, top); top += node.height + gap })
      columnOffsets.set(layer, offsets)
    })
    useStore.setState({ canvasNodes: state.canvasNodes.map((node) => {
      if (!selectedIds.has(node.id) || node.locked) return node
      const layer = layers.get(node.id) ?? 0
      return { ...node, position: { x: origin.x - 380 + layer * 430, y: columnOffsets.get(layer)?.get(node.id) ?? origin.y } }
    }) })
    fit()
  }

  const openImageEditor = async (nodeId: string) => {
    const state = useStore.getState()
    const node = state.canvasNodes.find((item) => item.id === nodeId)
    if (!node) return
    const imageId = getCanvasImageId(node, state.tasks)
    if (!imageId) { state.showToast('当前节点没有可编辑的图片', 'info'); return }
    setImageEditor({ nodeId, imageId })
  }

  const applyImageEdit = async (nodeId: string, result: CanvasImageEditResult) => {
    const imageIds = result.imageIds
    if (!imageIds.length) return
    checkpoint()
    const state = useStore.getState()
    const source = state.canvasNodes.find((node) => node.id === nodeId)
    if (!source) return
    const maskImageId = result.maskDataUrl ? await storeImage(result.maskDataUrl, 'mask') : undefined
    const groupId = imageIds.length > 1 ? createLocalId('canvas-group') : source.groupId
    // 评论锚点不是图片产物，必须挂在节点上，执行下游生成节点时才能透传给 API
    const comments = result.comments?.length ? result.comments : source.comments
    state.updateCanvasNode(nodeId, { type: 'image', imageId: imageIds[0], imageUrl: undefined, taskId: undefined, outputIndex: undefined, completedTaskId: undefined, label: imageIds.length > 1 ? '宫格图片 1' : result.comments?.length ? '评论锚点图片' : result.maskDataUrl ? '遮罩图片' : '编辑图片', groupId, maskImageId, maskTargetImageId: maskImageId ? imageIds[0] : undefined, comments })
    if (imageIds.length > 1) {
      const maxZ = Math.max(0, ...state.canvasNodes.map((node) => node.zIndex))
      const extraNodes: CanvasNode[] = imageIds.slice(1).map((imageId, index) => ({
        id: createLocalId('canvas-grid'), type: 'image', imageId, label: `宫格图片 ${index + 2}`,
        position: { x: source.position.x + (index + 1) * (source.width + 28), y: source.position.y }, width: source.width, height: source.height,
        zIndex: maxZ + index + 1, groupId,
      }))
      useStore.setState((current) => ({ canvasNodes: [...current.canvasNodes, ...extraNodes], canvasSelectedNodeIds: [nodeId, ...extraNodes.map((node) => node.id)] }))
    }
    setImageEditor(null)
    state.showToast(imageIds.length > 1 ? `已切分为 ${imageIds.length} 张图片` : '图片编辑结果已加入画布', 'success')
  }

  const exportProject = async () => {
    try {
      const state = useStore.getState()
      const portable = await Promise.all(state.canvasNodes.map(async (node) => {
        const imageId = getCanvasImageId(node, state.tasks)
        const imageUrl = imageId ? await ensureImageCached(imageId) : node.imageUrl
        if (imageId && !imageUrl) throw new Error('有图片无法读取，请重新导入后导出。')
        return node.type === 'generation' ? { ...node, taskId: undefined, completedTaskId: undefined } : imageUrl ? { ...node, type: 'image' as const, imageUrl, imageId: undefined, taskId: undefined } : node
      }))
      const project: CanvasProject = { id: 'default', name: state.canvasProjectName, nodes: portable, viewTransform: state.canvasTransform, createdAt: Date.now(), updatedAt: Date.now() }
      const url = URL.createObjectURL(new Blob([JSON.stringify(project)], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = `${state.canvasProjectName.replace(/[\\/:*?"<>|]/g, '_')}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { useStore.getState().showToast(error instanceof Error ? error.message : '导出失败', 'error') }
  }
  const importProject = async (file?: File) => {
    if (!file) return
    try {
      const project = normalizeCanvasProject(JSON.parse(await file.text()))
      if (!project) throw new Error('不是有效的画布工程')
      checkpoint()
      const remap = new Map(project.nodes.map((node) => [node.id, createLocalId('canvas-import')]))
      const incoming = project.nodes.map((node) => ({ ...node, id: remap.get(node.id)!, sourceNodeIds: node.sourceNodeIds?.map((id) => remap.get(id)!).filter(Boolean), parentNodeId: node.parentNodeId ? remap.get(node.parentNodeId) : undefined }))
      useStore.setState((state) => ({ canvasNodes: [...state.canvasNodes, ...incoming], canvasSelectedNodeIds: incoming.map((node) => node.id) }))
      fit(); useStore.getState().showToast('工程已加入当前画布', 'success')
    } catch (error) { useStore.getState().showToast(error instanceof Error ? error.message : '工程导入失败', 'error') }
  }
  const openMenu = (event: React.MouseEvent, nodeId?: string) => {
    event.preventDefault(); event.stopPropagation()
    if (nodeId) {
      const selectedIds = useStore.getState().canvasSelectedNodeIds
      if (!selectedIds.includes(nodeId)) useStore.getState().setCanvasSelectedNodeIds([nodeId])
    }
    setMenu({ nodeId, x: Math.min(event.clientX, window.innerWidth - 210), y: Math.min(event.clientY, window.innerHeight - 310), point: screenToWorld(screenPoint({ x: event.clientX, y: event.clientY }), useStore.getState().canvasTransform) })
  }

  const path = (from: Point, to: Point) => `M ${from.x} ${from.y} C ${from.x + Math.max(70, Math.abs(to.x - from.x) / 2)} ${from.y}, ${to.x - Math.max(70, Math.abs(to.x - from.x) / 2)} ${to.y}, ${to.x} ${to.y}`
  const menuNode = nodes.find((node) => node.id === menu?.nodeId)
  const groupFrames = Array.from(new Set(nodes.map((node) => node.groupId).filter((id): id is string => Boolean(id)))).map((groupId) => {
    const members = nodes.filter((node) => node.groupId === groupId)
    const x = Math.min(...members.map((node) => node.position.x)) - 18
    const y = Math.min(...members.map((node) => node.position.y)) - 34
    const right = Math.max(...members.map((node) => node.position.x + node.width)) + 18
    const bottom = Math.max(...members.map((node) => node.position.y + node.height)) + 18
    return { groupId, name: members.find((node) => node.groupName)?.groupName || '未命名分组', collapsed: members.every((node) => node.groupCollapsed), count: members.length, x, y, width: right - x, height: bottom - y }
  })

  return <div ref={viewport} className={`canvas-workspace ${tool === 'hand' ? 'hand-tool' : ''}`} data-standalone={!isPoolBuild || undefined} onPointerDown={(event) => pointerDown(event)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onContextMenu={(event) => { if (!(event.target as Element).closest('[data-canvas-ui],input,textarea,select')) openMenu(event) }}
    onDragOver={(event) => { if (loaded && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDropActive(true) } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false) }} onDrop={(event) => { event.preventDefault(); setDropActive(false); if (loaded) void importFiles(Array.from(event.dataTransfer.files), screenToWorld(screenPoint({ x: event.clientX, y: event.clientY }), transform)) }}>
    {showGrid && <div className="canvas-dot-grid" style={{ backgroundSize: `${Math.max(12, 24 * transform.scale)}px ${Math.max(12, 24 * transform.scale)}px`, backgroundPosition: `${transform.x}px ${transform.y}px` }} />}
    <div className="canvas-world" style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>
      <svg className="canvas-edges">{nodes.filter((target) => visibleNodeIds.has(target.id)).flatMap((target) => (target.sourceNodeIds?.length ? target.sourceNodeIds : target.parentNodeId ? [target.parentNodeId] : []).map((sourceId) => {
        const groupId = sourceId.startsWith('canvas-group-output-') ? sourceId.slice('canvas-group-output-'.length) : nodes.find((node) => node.id === sourceId)?.groupId
        const group = groupId ? groupFrames.find((item) => item.groupId === groupId) : undefined
        const source = nodes.find((node) => node.id === sourceId)
        if (group && !source) {
          const d = path({ x: group.x + group.width + 8, y: group.y + 18 }, { x: target.position.x - 8, y: target.position.y + 56 })
          return <g key={`${sourceId}-${target.id}`}><path d={d} className="canvas-edge" /><path d={d} className="canvas-edge-hit" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); checkpoint(); useStore.getState().updateCanvasNode(target.id, { sourceNodeIds: target.sourceNodeIds?.filter((id) => id !== sourceId) }); useStore.getState().showToast('已删除连接线', 'success') }}><title>双击断开分组连线</title></path></g>
        }
        if (!source) return null
        if (!visibleNodeIds.has(sourceId)) return null
        const d = path({ x: source.position.x + source.width + 8, y: source.position.y + 56 }, { x: target.position.x - 8, y: target.position.y + 56 })
        const lineage = !target.sourceNodeIds?.length && target.parentNodeId === sourceId
        const inactivePrompt = source.type === 'text' && target.promptMode === 'own'
        return <g key={`${sourceId}-${target.id}`}><path d={d} className={`canvas-edge ${lineage ? 'is-lineage' : inactivePrompt ? 'is-inactive' : ''}`} />{!lineage && <path d={d} className="canvas-edge-hit" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); checkpoint(); useStore.getState().updateCanvasNode(target.id, { sourceNodeIds: target.sourceNodeIds?.filter((id) => id !== sourceId) }); useStore.getState().showToast('已删除连接线', 'success') }}><title>双击断开输入连线</title></path>}</g>
      }))}{connection && (() => { const source = nodes.find((node) => node.id === connection.sourceId); const group = groupFrames.find((item) => item.groupId === connection.sourceId.replace('canvas-group-output-', '')); return (source || group) && <path className="canvas-edge is-preview" d={path(source ? { x: source.position.x + source.width + 8, y: source.position.y + 56 } : { x: group!.x + group!.width + 8, y: group!.y + 18 }, connection.point)} /> })()}</svg>
      {groupFrames.map((group) => <button key={group.groupId} type="button" data-canvas-ui className={`canvas-group-frame ${group.collapsed ? 'is-collapsed' : ''}`} style={{ left: group.x, top: group.y, width: group.width, height: group.height }} onPointerDown={(event) => { if ((event.target as Element).closest('[data-canvas-group-connect]')) return; groupPointerDown(event, group.groupId) }} onClick={(event) => { event.stopPropagation(); if (!suppressGroupClick.current) toggleGroup(group.groupId); suppressGroupClick.current = false }}><span>{group.name}</span><small>{group.collapsed ? `${group.count} 个节点 · 拖动移动 · 点击展开` : '拖动移动 · 点击折叠'}</small><i className="canvas-group-port" data-canvas-group-connect aria-label="连接整组素材" title="连接整组素材" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); const point = { x: event.clientX, y: event.clientY }; viewport.current?.setPointerCapture(event.pointerId); const sourceId = canvasGroupPortId(group.groupId); gesture.current = { kind: 'connect', sourceId, start: point, origin: point, moved: false }; setConnection({ sourceId, point: screenToWorld(screenPoint(point), transform) }) }} /></button>)}
      {nodes.filter((node) => !node.groupCollapsed).map((node) => <CanvasNodeCard key={node.id} node={node} hasConnectedText={Boolean(node.sourceNodeIds?.some((id) => nodes.find((source) => source.id === id)?.type === 'text'))} isSelected={selected.includes(node.id)} busy={busy.includes(node.id)} promptRewriteBusy={promptRewriteBusy.includes(node.id)} isConnectionTarget={Boolean(connection && node.type === 'generation' && connection.sourceId !== node.id && canConnectCanvasNodes(nodes, connection.sourceId, node.id))} onPointerDown={pointerDown} onResizeStart={resizePointerDown} onRun={(id) => void runNode(id)} onEdit={edit} onDownload={(id) => void download(id)} onDoubleClick={preview} onMenu={openMenu} onPromptLibrary={(id) => { setPromptLibraryTarget(id); setPromptLibraryOpen(true) }} onPromptRewrite={(id, profileId) => {
          const current = nodes.find((item) => item.id === id)?.prompt?.trim()
          if (!current || promptRewriteBusy.includes(id)) return
          const profile = settings.profiles.find((item) => item.id === profileId) || getAgentTextApiProfile(settings)
          if (!profile || !isAgentTextApiProfile(profile)) { useStore.getState().showToast('请先在设置中配置 Agent 文本模型', 'error'); return }
          setPromptRewriteBusy((items) => [...items, id])
          useStore.getState().showToast('正在使用 AI 润色提示词…', 'info')
          void rewriteCanvasPrompt({ settings, profile, prompt: current })
            .then((rewritten) => { useStore.getState().updateCanvasNode(id, { prompt: rewritten }); useStore.getState().showToast('提示词已润色', 'success') })
            .catch((error: unknown) => { useStore.getState().showToast(error instanceof Error ? error.message : 'AI 润色失败', 'error') })
            .finally(() => setPromptRewriteBusy((items) => items.filter((item) => item !== id)))
        }} onConnect={(event, sourceId) => {
        event.preventDefault(); event.stopPropagation(); if (!loaded) return
        viewport.current?.setPointerCapture(event.pointerId)
        const point = { x: event.clientX, y: event.clientY }
        gesture.current = { kind: 'connect', sourceId, start: point, origin: point, moved: false }; setConnection({ sourceId, point: screenToWorld(screenPoint(point), transform) })
      }} />)}
    </div>
    <div className="canvas-project" data-canvas-ui>
      <button className="canvas-project-trigger" type="button" popoverTarget="canvas-project-panel" disabled={!loaded}>
        <span className="truncate">{projectName || '未命名画布'}</span><span aria-hidden="true" className="canvas-project-chevron" />
      </button>
      {status && <p className="canvas-project-status" role="status">{status}</p>}
      <div id="canvas-project-panel" className="canvas-project-panel" popover="auto" aria-label="画布工程">
        <label>
          画布名称
          <input value={projectName} onChange={(event) => useStore.setState({ canvasProjectName: event.target.value })} onBlur={() => { void renameProject(useStore.getState().canvasProjectName) }} />
        </label>
        <label>
          切换画布工程
          <select value={activeProjectId} disabled={!loaded} onChange={(event) => { void switchProject(event.target.value) }}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <div className="canvas-project-actions">
          <button type="button" disabled={!loaded} onClick={() => void save()}>保存</button>
          <button type="button" disabled={!loaded} onClick={() => { const next = window.prompt('工程名称', '未命名画布'); if (next !== null) void createProject(next) }}>新建</button>
          <button type="button" disabled={!loaded} onClick={() => projectInput.current?.click()}>导入工程</button>
          <button type="button" disabled={!loaded} onClick={() => void exportProject()}>导出工程</button>
          <button type="button" disabled={!loaded} onClick={arrange}>按连接整理</button>
          <button type="button" className="canvas-project-delete" disabled={!loaded} onClick={() => { if (window.confirm('删除当前画布工程？')) void removeProject() }}>删除工程</button>
        </div>
      </div>
    </div>
    {!nodes.length && loaded && <div className="canvas-welcome">
      <h2 className="studio-empty-title">空白画布</h2>
      <p className="studio-empty-description">添加图片和提示词，再连接到生成节点。</p>
      <button data-canvas-ui onClick={() => addNode('generation')}><CanvasIcon name="generate" />添加生成节点</button>
    </div>}
    {!loaded && <div className="canvas-load-state" data-canvas-ui><p>{status}</p><button onClick={() => void load()}>重新恢复</button></div>}
    <div className="canvas-dock" data-canvas-ui>
      <div className="canvas-create-tools" role="group" aria-label="创建与素材">
        <button type="button" disabled={!loaded} title="上传图片（支持拖入 / 粘贴）" onClick={() => uploadInput.current?.click()}><CanvasIcon name="image" />图片</button>
        <button type="button" disabled={!loaded} onClick={() => addNode('text')}><CanvasIcon name="text" />提示词</button>
        <button type="button" disabled={!loaded} onClick={() => addNode('generation')}><CanvasIcon name="generate" />生成</button>
        <button type="button" disabled={!loaded} aria-pressed={libraryOpen} className={libraryOpen ? 'active' : ''} onClick={() => setLibraryOpen(!libraryOpen)}><CanvasIcon name="library" />素材库</button>
        <button type="button" disabled={!loaded} aria-pressed={promptLibraryOpen} className={promptLibraryOpen ? 'active' : ''} onClick={() => setPromptLibraryOpen(!promptLibraryOpen)}><CanvasIcon name="text" />词库</button>
      </div>
      <CanvasToolbar tool={tool} scale={transform.scale} grid={showGrid} onTool={setTool} onZoom={(factor) => { const element = viewport.current!; useStore.getState().setCanvasTransform(zoomAtScreenPoint(transform, { x: element.clientWidth / 2, y: element.clientHeight / 2 }, transform.scale * factor)) }} onFocus={focusSelected} onHelp={() => setShortcutHelpOpen(true)} onFit={fit} onGrid={() => useStore.getState().setCanvasShowGrid(!showGrid)} onUndo={() => undo()} onRedo={() => undo(true)} canUndo={history.current.undo.length > 0} canRedo={history.current.redo.length > 0} />
    </div>
    <div className="canvas-help">{selected.length ? `${selected.length} 个已选 · Delete 移除 · 右键更多` : '拖动圆点连接 · 双击连线断开 · V 选择 / H 平移'}</div>
    {selected.length > 0 && <div className="canvas-selection-actions" data-canvas-ui role="toolbar" aria-label="选中节点操作"><strong>{selected.length} 个节点</strong><i /><button title="聚焦选中节点" aria-label="聚焦选中节点" onClick={focusSelected}><CanvasIcon name="focus" /><span>聚焦</span></button><button title="复制选中节点" aria-label="复制选中节点" onClick={duplicateSelected}><span>复制</span></button><button title="给选中节点分组" aria-label="给选中节点分组" disabled={selected.length < 2} onClick={groupSelected}><span>分组</span></button><button title="折叠或展开选中节点所属分组" aria-label="折叠或展开选中节点所属分组" disabled={!selected.some((id) => nodes.find((node) => node.id === id)?.groupId)} onClick={toggleSelectedGroups}><span>收起组</span></button><button title="解散选中节点所属分组" disabled={!selected.some((id) => nodes.find((node) => node.id === id)?.groupId)} onClick={ungroupSelected}>解散组</button><button title="锁定或解锁选中节点" aria-label="锁定或解锁选中节点" onClick={toggleSelectedLocked}><span>锁定</span></button><button className="is-danger" title="删除选中节点" aria-label="删除选中节点" onClick={removeSelected}><span>删除</span></button></div>}
    {libraryOpen && <CanvasLibrary onAdd={addHistoryImage} onClose={() => setLibraryOpen(false)} />}
    {promptLibraryOpen && <CanvasPromptLibrary onUse={addPromptFromLibrary} onClose={() => setPromptLibraryOpen(false)} />}
    {box && <div className="canvas-selection" style={{ left: Math.min(box.from.x, box.to.x), top: Math.min(box.from.y, box.to.y), width: Math.abs(box.from.x - box.to.x), height: Math.abs(box.from.y - box.to.y) }} />}
    {dropActive && <div className="canvas-drop-overlay"><CanvasIcon name="image" /><strong>松开，将图片放入画布</strong></div>}
    {menu && <div className="canvas-node-menu" data-canvas-ui style={{ left: menu.x, top: menu.y }}>{menuNode ? <>
      <div className="canvas-menu-title">{menuNode.label || '节点'}</div><button onClick={() => { checkpoint(); useStore.getState().bringCanvasNodeToFront(menuNode.id); setMenu(null) }}>置于顶层</button><button onClick={() => { checkpoint(); useStore.getState().updateCanvasNode(menuNode.id, { locked: !menuNode.locked }); setMenu(null) }}>{menuNode.locked ? '解锁位置' : '锁定位置'}</button>
      <button onClick={() => { const node = structuredClone(menuNode); checkpoint(); const id = createLocalId('canvas-copy'); useStore.getState().addCanvasNode({ ...node, id, position: { x: node.position.x + 40, y: node.position.y + 40 }, taskId: node.type === 'generation' ? undefined : node.taskId, completedTaskId: undefined, zIndex: Date.now() }); setMenu(null) }}>复制节点</button>
      {selected.length >= 2 && selected.includes(menuNode.id) && <button onClick={() => { groupSelected(); setMenu(null) }}>添加分组 <span className="canvas-menu-shortcut">Ctrl/Cmd + G</span></button>}
      {menuNode.groupId && <button onClick={() => { toggleSelectedGroups(); setMenu(null) }}>折叠 / 展开分组 <span className="canvas-menu-shortcut">Ctrl/Cmd + Shift + G</span></button>}
      {menuNode.type !== 'text' && menuNode.type !== 'generation' && <><button onClick={() => { edit(menuNode.id); setMenu(null) }}>以此图创建编辑节点</button><button onClick={() => { void openImageEditor(menuNode.id); setMenu(null) }}>裁剪 / 画笔编辑</button><button onClick={() => { void download(menuNode.id); setMenu(null) }}>下载图片</button></>}
       {menuNode.groupId && <><button onClick={() => { renameSelectedGroup(); setMenu(null) }}>重命名分组</button><button onClick={() => { toggleGroup(menuNode.groupId!); setMenu(null) }}>{menuNode.groupCollapsed ? '展开分组' : '折叠分组'}</button><button onClick={() => { ungroupSelected(); setMenu(null) }}>解散分组</button></>}
      <button className="danger" disabled={menuNode.locked} onClick={removeSelected}>从画布移除</button>
    </> : <>{selected.length >= 2 && <button onClick={() => { groupSelected(); setMenu(null) }}>添加分组 <span className="canvas-menu-shortcut">Ctrl/Cmd + G</span></button>}<button onClick={() => addNode('generation', menu.point)}>添加生成节点</button><button onClick={() => addNode('text', menu.point)}>添加提示词节点</button><button onClick={() => { uploadInput.current?.click(); setMenu(null) }}>上传图片</button><button onClick={() => { setLibraryOpen(true); setMenu(null) }}>打开素材库</button></>}</div>}
    <input ref={uploadInput} type="file" accept="image/*" multiple hidden onChange={(event) => { void importFiles(Array.from(event.target.files || [])); event.target.value = '' }} />
    <input ref={projectInput} type="file" accept=".json,application/json" hidden onChange={(event) => { void importProject(event.target.files?.[0]); event.target.value = '' }} />
    <CanvasMiniMap nodes={overviewNodes} transform={transform} onNavigate={(world) => { const element = viewport.current; if (!element) return; useStore.getState().setCanvasTransform({ ...transform, x: element.clientWidth / 2 - world.x * transform.scale, y: element.clientHeight / 2 - world.y * transform.scale }) }} />
    {imageEditor && <CanvasImageEditorModal imageId={imageEditor.imageId} onClose={() => setImageEditor(null)} onApply={(result) => applyImageEdit(imageEditor.nodeId, result)} />}
    {shortcutHelpOpen && <div className="canvas-shortcut-backdrop" data-canvas-ui onClick={() => setShortcutHelpOpen(false)}><section className="canvas-shortcut-dialog" role="dialog" aria-modal="true" aria-labelledby="canvas-shortcuts-title" onClick={(event) => event.stopPropagation()}><header><strong id="canvas-shortcuts-title">画布快捷操作</strong><button aria-label="关闭快捷键帮助" onClick={() => setShortcutHelpOpen(false)}>×</button></header><div className="canvas-shortcut-grid"><span>V</span><p>选择工具</p><span>H</span><p>平移工具</p><span>F</span><p>聚焦选中节点</p><span>Space</span><p>临时平移画布</p><span>Ctrl / Cmd + G</span><p>给选中节点分组</p><span>Ctrl / Cmd + Shift + G</span><p>折叠 / 展开选中节点所属分组</p><span>Delete</span><p>移除选中节点</p><span>Ctrl / Cmd + Z</span><p>撤销操作</p><span>?</span><p>打开本面板</p></div></section></div>}
  </div>
}


