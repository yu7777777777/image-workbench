// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasProject } from '../types'

const db = vi.hoisted(() => ({
  projects: new Map<string, CanvasProject>(),
  activeId: 'a',
  puts: [] as CanvasProject[],
  barrier: null as Promise<void> | null,
}))

vi.mock('../lib/db', () => ({
  listCanvasProjects: vi.fn(async () => [...db.projects.values()]),
  getCanvasProject: vi.fn(async (id: string) => db.projects.get(id)),
  putCanvasProject: vi.fn(async (project: CanvasProject) => {
    db.puts.push(structuredClone(project))
    if (db.barrier) await db.barrier
    db.projects.set(project.id, structuredClone(project))
    return project.id
  }),
  deleteCanvasProject: vi.fn(async (id: string) => { db.projects.delete(id) }),
  getActiveCanvasProjectId: vi.fn(async () => db.activeId),
  putActiveCanvasProjectId: vi.fn(async (id: string) => { db.activeId = id; return id }),
}))

vi.mock('../store', async () => {
  const { create } = await import('zustand')
  return {
    useStore: create(() => ({
      canvasNodes: [], canvasSelectedNodeIds: [], canvasTransform: { scale: 1, x: 0, y: 0 }, canvasProjectName: '未命名画布',
      showToast: vi.fn(),
    })),
  }
})

import { useStore } from '../store'
import { useCanvasProject } from './useCanvasProject'
import { notifyCanvasProjectsChanged } from '../lib/canvasProjectEvents'

type HookValue = ReturnType<typeof useCanvasProject>
let current: HookValue

function Harness() {
  current = useCanvasProject()
  return null
}

const project = (id: string, name: string): CanvasProject => ({ id, name, nodes: [], viewTransform: { scale: 1, x: 0, y: 0 }, createdAt: 1, updatedAt: 1 })

describe('useCanvasProject', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    db.projects.clear()
    db.projects.set('a', project('a', '工程 A'))
    db.projects.set('b', project('b', '工程 B'))
    db.activeId = 'a'
    db.puts = []
    db.barrier = null
    useStore.setState({ canvasNodes: [], canvasSelectedNodeIds: [], canvasTransform: { scale: 1, x: 0, y: 0 }, canvasProjectName: '未命名画布', showToast: vi.fn() })
  })

  afterEach(() => vi.useRealTimers())

  it('does not let an old autosave timer write into the project being switched to', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => root.render(<Harness />))
    await act(async () => Promise.resolve())
    useStore.setState({ canvasProjectName: '工程 A 已修改' })
    let release = () => {}
    db.barrier = new Promise<void>((resolve) => { release = resolve })
    let switching: Promise<void>
    act(() => { switching = current.switchProject('b') })
    await act(async () => vi.advanceTimersByTimeAsync(800))
    db.barrier = null
    release()
    await act(async () => switching!)
    expect(current.activeProjectId).toBe('b')
    expect(db.puts.filter((item) => item.id === 'b' && item.name === '工程 A 已修改')).toEqual([])
    await act(async () => root.unmount())
  })

  it('resets the active selection to default after deleting the last project', async () => {
    db.projects.delete('b')
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => root.render(<Harness />))
    await act(async () => Promise.resolve())
    await act(async () => current.removeProject())
    expect(current.activeProjectId).toBe('default')
    expect(db.activeId).toBe('default')
    expect(db.projects.has('a')).toBe(false)
    expect(db.projects.get('default')?.nodes).toEqual([])
    await act(async () => root.unmount())
  })

  it('syncs an external ZIP import while the canvas hook is mounted', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => root.render(<Harness />))
    await act(async () => Promise.resolve())
    const imported = project('imported', '导入工程')
    imported.nodes = [{ id: 'imported-node', type: 'text', label: '来自备份', position: { x: 0, y: 0 }, width: 280, height: 120, zIndex: 1 }]
    db.projects.set(imported.id, imported)
    db.activeId = imported.id
    useStore.setState({ canvasNodes: imported.nodes, canvasProjectName: imported.name, canvasTransform: imported.viewTransform })
    await act(async () => { notifyCanvasProjectsChanged(imported.id); await Promise.resolve() })
    await act(async () => Promise.resolve())
    expect(current.activeProjectId).toBe('imported')
    expect(current.projects.some((item) => item.id === 'imported')).toBe(true)
    expect(useStore.getState().canvasProjectName).toBe('导入工程')
    await act(async () => root.unmount())
  })
})
