import { beforeEach, describe, expect, it } from 'vitest'
import { create, type StateCreator } from 'zustand'
import { createCanvasSlice, type CanvasSlice } from './canvasSlice'
import type { CanvasNode } from '../types'

function createTestNode(id: string, patch: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    type: 'task',
    taskId: `task-${id}`,
    position: { x: 0, y: 0 },
    width: 280,
    height: 320,
    zIndex: 1,
    ...patch,
  }
}

function createTestStore(initialState?: Partial<CanvasSlice>) {
  return create<CanvasSlice>()((set, get, api) => ({
    ...(createCanvasSlice as unknown as StateCreator<CanvasSlice>)(set, get, api),
    ...initialState,
  }))
}

describe('Canvas Slice', () => {
  let store: ReturnType<typeof createTestStore>

  beforeEach(() => {
    store = createTestStore()
  })

  // 测试 addCanvasNode
  it('should add a canvas node', () => {
    expect(store.getState().canvasNodes).toEqual([])

    const node1 = createTestNode('node-1', { position: { x: 10, y: 20 } })
    store.getState().addCanvasNode(node1)

    expect(store.getState().canvasNodes).toHaveLength(1)
    expect(store.getState().canvasNodes[0]).toEqual(node1)

    const node2 = createTestNode('node-2', { position: { x: 50, y: 60 } })
    store.getState().addCanvasNode(node2)

    expect(store.getState().canvasNodes).toHaveLength(2)
    expect(store.getState().canvasNodes).toEqual([node1, node2])
  })

  // 测试 removeCanvasNodes
  it('should remove canvas nodes and clear their selection', () => {
    const node1 = createTestNode('node-1')
    const node2 = createTestNode('node-2')
    const node3 = createTestNode('node-3')

    store.getState().addCanvasNode(node1)
    store.getState().addCanvasNode(node2)
    store.getState().addCanvasNode(node3)
    store.getState().setCanvasSelectedNodeIds(['node-1', 'node-2', 'external-id'])

    expect(store.getState().canvasNodes).toHaveLength(3)
    expect(store.getState().canvasSelectedNodeIds).toEqual(['node-1', 'node-2', 'external-id'])

    // 移除 node-1 和 external-id
    store.getState().removeCanvasNodes(['node-1', 'external-id'])

    expect(store.getState().canvasNodes.map((n) => n.id)).toEqual(['node-2', 'node-3'])
    expect(store.getState().canvasSelectedNodeIds).toEqual(['node-2'])

    // 再次移除不存在的节点 id，状态保持不变
    store.getState().removeCanvasNodes(['non-existent'])
    expect(store.getState().canvasNodes.map((n) => n.id)).toEqual(['node-2', 'node-3'])
    expect(store.getState().canvasSelectedNodeIds).toEqual(['node-2'])
  })

  // 测试 updateCanvasNode
  it('should update a canvas node by id', () => {
    const node1 = createTestNode('node-1', { width: 280, height: 320 })
    const node2 = createTestNode('node-2', { width: 280, height: 320 })

    store.getState().addCanvasNode(node1)
    store.getState().addCanvasNode(node2)

    // 更新 node-1 的属性
    store.getState().updateCanvasNode('node-1', { width: 400, height: 500, locked: true })

    const updatedNode1 = store.getState().canvasNodes.find((n) => n.id === 'node-1')
    const updatedNode2 = store.getState().canvasNodes.find((n) => n.id === 'node-2')

    expect(updatedNode1).toEqual({
      ...node1,
      width: 400,
      height: 500,
      locked: true,
    })
    // node-2 应不受影响
    expect(updatedNode2).toEqual(node2)

    // 更新不存在的节点应静默无副作用
    store.getState().updateCanvasNode('non-existent', { width: 999 })
    expect(store.getState().canvasNodes.find((n) => n.id === 'node-1')?.width).toBe(400)
    expect(store.getState().canvasNodes.find((n) => n.id === 'node-2')?.width).toBe(280)
  })

  // 测试 moveCanvasNode
  it('should move a canvas node position', () => {
    const node1 = createTestNode('node-1', { position: { x: 10, y: 20 } })
    const node2 = createTestNode('node-2', { position: { x: 30, y: 40 } })

    store.getState().addCanvasNode(node1)
    store.getState().addCanvasNode(node2)

    store.getState().moveCanvasNode('node-1', { x: 150, y: 250 })

    expect(store.getState().canvasNodes.find((n) => n.id === 'node-1')?.position).toEqual({
      x: 150,
      y: 250,
    })
    // node-2 的位置保持不变
    expect(store.getState().canvasNodes.find((n) => n.id === 'node-2')?.position).toEqual({
      x: 30,
      y: 40,
    })

    // 移动不存在的节点
    store.getState().moveCanvasNode('non-existent', { x: 0, y: 0 })
    expect(store.getState().canvasNodes.find((n) => n.id === 'node-1')?.position).toEqual({
      x: 150,
      y: 250,
    })
  })

  // 测试 bringCanvasNodeToFront
  it('should bring node to front with highest zIndex', () => {
    const node1 = createTestNode('node-1', { zIndex: 1 })
    const node2 = createTestNode('node-2', { zIndex: 5 })
    const node3 = createTestNode('node-3', { zIndex: 2 })

    store.getState().addCanvasNode(node1)
    store.getState().addCanvasNode(node2)
    store.getState().addCanvasNode(node3)

    // 将 node-1 置顶，此时最大 zIndex 为 5，node-1 应变为 6
    store.getState().bringCanvasNodeToFront('node-1')
    expect(store.getState().canvasNodes.find((n) => n.id === 'node-1')?.zIndex).toBe(6)
    expect(store.getState().canvasNodes.find((n) => n.id === 'node-2')?.zIndex).toBe(5)
    expect(store.getState().canvasNodes.find((n) => n.id === 'node-3')?.zIndex).toBe(2)

    // 再次将 node-3 置顶，此时最大 zIndex 为 6，node-3 应变为 7
    store.getState().bringCanvasNodeToFront('node-3')
    expect(store.getState().canvasNodes.find((n) => n.id === 'node-3')?.zIndex).toBe(7)

    // 测试当所有节点 zIndex <= 0 时的兜底逻辑 (Math.max(..., 0) + 1 = 1)
    const zeroStore = createTestStore()
    const nodeZero = createTestNode('node-zero', { zIndex: 0 })
    zeroStore.getState().addCanvasNode(nodeZero)
    zeroStore.getState().bringCanvasNodeToFront('node-zero')
    expect(zeroStore.getState().canvasNodes[0].zIndex).toBe(1)
  })

  // 测试 importTasksToCanvas (不重复导入)
  it('should not import duplicate task nodes', () => {
    const existingNode = createTestNode('existing-node', { taskId: 'task-1', zIndex: 3 })
    store.getState().addCanvasNode(existingNode)

    // 导入 task-1（已存在）、task-2 和 task-3（新）
    store.getState().importTasksToCanvas(['task-1', 'task-2', 'task-3'])

    const nodes = store.getState().canvasNodes
    expect(nodes).toHaveLength(3)

    // 验证已有节点不受影响
    expect(nodes[0]).toEqual(existingNode)

    // 验证新加入的节点
    const newTaskNodes = nodes.slice(1)
    expect(newTaskNodes.map((n) => n.taskId)).toEqual(['task-2', 'task-3'])

    // 验证新节点的属性规范
    const CARD_WIDTH = 280
    const CARD_HEIGHT = 320
    const COLS = 4
    const GAP = 40

    // startIndex = 1（因为已有 1 个节点）
    // i=0 (task-2): x = ((1 + 0) % 4) * (280 + 40) = 1 * 320 = 320
    //               y = Math.floor((1 + 0) / 4) * (320 + 40) = 0 * 360 = 0
    //               zIndex = maxZ(3) + 0 + 1 = 4
    expect(newTaskNodes[0]).toMatchObject({
      type: 'task',
      taskId: 'task-2',
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      position: { x: 320, y: 0 },
      zIndex: 4,
    })
    expect(newTaskNodes[0].id).toMatch(/^canvas-task-2-\d+$/)

    // i=1 (task-3): x = ((1 + 1) % 4) * 320 = 2 * 320 = 640
    //               y = Math.floor((1 + 1) / 4) * 360 = 0 * 360 = 0
    //               zIndex = maxZ(3) + 1 + 1 = 5
    expect(newTaskNodes[1]).toMatchObject({
      type: 'task',
      taskId: 'task-3',
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      position: { x: 640, y: 0 },
      zIndex: 5,
    })
    expect(newTaskNodes[1].id).toMatch(/^canvas-task-3-\d+$/)

    // 再次调用 importTasksToCanvas 传入已有任务，不应新增任何节点
    store.getState().importTasksToCanvas(['task-1', 'task-2', 'task-3'])
    expect(store.getState().canvasNodes).toHaveLength(3)
  })

  // 测试 clearCanvas
  it('should clear all canvas state', () => {
    const node1 = createTestNode('node-1')
    const node2 = createTestNode('node-2')
    store.getState().addCanvasNode(node1)
    store.getState().addCanvasNode(node2)
    store.getState().setCanvasSelectedNodeIds(['node-1'])
    store.getState().setCanvasTransform({ scale: 2.5, x: 200, y: -100 })

    expect(store.getState().canvasNodes).toHaveLength(2)
    expect(store.getState().canvasSelectedNodeIds).toEqual(['node-1'])
    expect(store.getState().canvasTransform).toEqual({ scale: 2.5, x: 200, y: -100 })

    store.getState().clearCanvas()

    expect(store.getState().canvasNodes).toEqual([])
    expect(store.getState().canvasSelectedNodeIds).toEqual([])
    expect(store.getState().canvasTransform).toEqual({ scale: 1, x: 0, y: 0 })
  })

  // 测试 setCanvasTransform
  it('should update canvas transform', () => {
    expect(store.getState().canvasTransform).toEqual({ scale: 1, x: 0, y: 0 })

    store.getState().setCanvasTransform({ scale: 1.5, x: 100, y: 200 })
    expect(store.getState().canvasTransform).toEqual({ scale: 1.5, x: 100, y: 200 })

    store.getState().setCanvasTransform({ scale: 0.8, x: -50, y: -80 })
    expect(store.getState().canvasTransform).toEqual({ scale: 0.8, x: -50, y: -80 })
  })

  // 扩展测试：setCanvasShowGrid 与 setCanvasSelectedNodeIds
  it('should update canvas show grid and selected node ids', () => {
    expect(store.getState().canvasShowGrid).toBe(true)
    store.getState().setCanvasShowGrid(false)
    expect(store.getState().canvasShowGrid).toBe(false)
    store.getState().setCanvasShowGrid(true)
    expect(store.getState().canvasShowGrid).toBe(true)

    expect(store.getState().canvasSelectedNodeIds).toEqual([])
    store.getState().setCanvasSelectedNodeIds(['a', 'b'])
    expect(store.getState().canvasSelectedNodeIds).toEqual(['a', 'b'])
  })
})
