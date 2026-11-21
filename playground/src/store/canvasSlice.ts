import type { StateCreator } from 'zustand'
import type { CanvasNode } from '../types'
import type { CanvasTransform } from '../lib/canvasTransform'
import type { AppState } from '../store'

export interface CanvasSlice {
  canvasNodes: CanvasNode[]
  canvasTransform: CanvasTransform
  canvasSelectedNodeIds: string[]
  canvasShowGrid: boolean
  canvasProjectName: string
  setCanvasTransform: (transform: CanvasTransform) => void
  setCanvasShowGrid: (show: boolean) => void
  setCanvasSelectedNodeIds: (ids: string[]) => void
  addCanvasNode: (node: CanvasNode) => void
  removeCanvasNodes: (ids: string[]) => void
  updateCanvasNode: (id: string, patch: Partial<CanvasNode>) => void
  moveCanvasNode: (id: string, position: { x: number; y: number }) => void
  bringCanvasNodeToFront: (id: string) => void
  importTasksToCanvas: (taskIds: string[]) => void
  clearCanvas: () => void
}

export const createCanvasSlice: StateCreator<AppState, [], [], CanvasSlice> = (set, get) => ({
  canvasNodes: [],
  canvasTransform: { scale: 1, x: 0, y: 0 },
  canvasSelectedNodeIds: [],
  canvasShowGrid: true,
  canvasProjectName: '未命名画布',
  
  setCanvasTransform: (transform: CanvasTransform) => set({ canvasTransform: transform }),
  setCanvasShowGrid: (show: boolean) => set({ canvasShowGrid: show }),
  setCanvasSelectedNodeIds: (ids: string[]) => set({ canvasSelectedNodeIds: ids }),
  
  addCanvasNode: (node: CanvasNode) => set((s) => ({ canvasNodes: [...s.canvasNodes, node] })),
  
  removeCanvasNodes: (ids: string[]) => set((s) => ({
    canvasNodes: s.canvasNodes.filter(n => !ids.includes(n.id)).map((node) => ({ ...node, sourceNodeIds: node.sourceNodeIds?.filter((id) => !ids.includes(id)) })),
    canvasSelectedNodeIds: s.canvasSelectedNodeIds.filter(id => !ids.includes(id)),
  })),
  
  updateCanvasNode: (id: string, patch: Partial<CanvasNode>) => set((s) => ({
    canvasNodes: s.canvasNodes.map(n => n.id === id ? { ...n, ...patch } : n),
  })),
  
  moveCanvasNode: (id: string, position: { x: number; y: number }) => set((s) => ({
    canvasNodes: s.canvasNodes.map(n => n.id === id && !n.locked ? { ...n, position } : n),
  })),
  
  bringCanvasNodeToFront: (id: string) => set((s) => {
    const maxZ = Math.max(...s.canvasNodes.map(n => n.zIndex), 0)
    return { canvasNodes: s.canvasNodes.map(n => n.id === id ? { ...n, zIndex: maxZ + 1 } : n) }
  }),
  
  importTasksToCanvas: (taskIds: string[]) => set((s) => {
    const CARD_WIDTH = 280
    const CARD_HEIGHT = 320
    const COLS = 4
    const GAP = 40
    const existingIds = new Set(s.canvasNodes.map(n => n.taskId))
    const newTaskIds = taskIds.filter(id => !existingIds.has(id))
    const startIndex = s.canvasNodes.length
    const maxZ = Math.max(...s.canvasNodes.map(n => n.zIndex), 0)
    
    const newNodes: CanvasNode[] = newTaskIds.map((taskId, i) => ({
      id: `canvas-${taskId}-${Date.now()}`,
      type: 'task' as const,
      taskId,
      position: {
        x: ((startIndex + i) % COLS) * (CARD_WIDTH + GAP),
        y: Math.floor((startIndex + i) / COLS) * (CARD_HEIGHT + GAP),
      },
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      zIndex: maxZ + i + 1,
    }))
    
    return { canvasNodes: [...s.canvasNodes, ...newNodes] }
  }),
  
  clearCanvas: () => set({
    canvasNodes: [],
    canvasSelectedNodeIds: [],
    canvasTransform: { scale: 1, x: 0, y: 0 },
  }),
})
