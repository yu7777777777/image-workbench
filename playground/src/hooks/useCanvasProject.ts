import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { deleteCanvasProject, getActiveCanvasProjectId, getCanvasProject, listCanvasProjects, putActiveCanvasProjectId, putCanvasProject } from '../lib/db'
import { CANVAS_PROJECT_ID, normalizeCanvasProject } from '../lib/canvasWorkflow'
import { createLocalId } from '../lib/id'
import { CANVAS_PROJECTS_CHANGED_EVENT } from '../lib/canvasProjectEvents'
import type { CanvasProject } from '../types'

const DEFAULT_PROJECT_NAME = '未命名画布'

export function useCanvasProject() {
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState('正在恢复画布…')
  const [projects, setProjects] = useState<CanvasProject[]>([])
  const [activeProjectId, setActiveProjectId] = useState(CANVAS_PROJECT_ID)
  const activeId = useRef(CANVAS_PROJECT_ID)
  const createdAt = useRef(Date.now())
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())
  const loadToken = useRef(0)
  const operationQueue = useRef<Promise<unknown>>(Promise.resolve())
  const projectEpoch = useRef(0)
  const transitioning = useRef(false)
  const transitionCount = useRef(0)
  const nodes = useStore((state) => state.canvasNodes)
  const transform = useStore((state) => state.canvasTransform)
  const name = useStore((state) => state.canvasProjectName)

  const refreshProjects = useCallback(async () => {
    const values = (await listCanvasProjects()).map((value) => normalizeCanvasProject(value)).filter((value): value is CanvasProject => Boolean(value))
    values.sort((a, b) => b.updatedAt - a.updatedAt)
    setProjects(values)
    return values
  }, [])

  const save = useCallback(async (id = activeId.current) => {
    const state = useStore.getState()
    const project: CanvasProject = {
      id,
      name: state.canvasProjectName.trim() || DEFAULT_PROJECT_NAME,
      nodes: structuredClone(state.canvasNodes),
      viewTransform: { ...state.canvasTransform },
      createdAt: id === activeId.current ? createdAt.current : Date.now(),
      updatedAt: Date.now(),
    }
    setStatus('保存中…')
    const pending = saveQueue.current.catch(() => {}).then(() => putCanvasProject(project))
    saveQueue.current = pending
    await pending
    if (id === activeId.current) {
      createdAt.current = project.createdAt
      setStatus('已保存')
      setProjects((current) => [project, ...current.filter((item) => item.id !== id)].sort((a, b) => b.updatedAt - a.updatedAt))
    }
  }, [])

  const runOperation = useCallback(async (label: string, operation: () => Promise<void>) => {
    transitionCount.current++
    transitioning.current = true
    projectEpoch.current++
    const run = operationQueue.current.catch(() => {}).then(async () => {
      try {
        await operation()
      } finally {
        transitionCount.current = Math.max(0, transitionCount.current - 1)
        transitioning.current = transitionCount.current > 0
      }
    })
    operationQueue.current = run
    try {
      await run
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label}失败`
      console.warn(`${label}失败`, error)
      setStatus(`${label}失败，请重试`)
      useStore.getState().showToast(message || `${label}失败`, 'error')
    }
  }, [])

  const loadProject = useCallback(async (projectId: string, values?: CanvasProject[]) => {
    const token = ++loadToken.current
    const stored = await getCanvasProject(projectId)
    const project = normalizeCanvasProject(stored)
    if (stored && !project) throw new Error('工程格式无法读取，已保留原数据。')
    if (token !== loadToken.current) return
    const next = project ?? { id: projectId, name: DEFAULT_PROJECT_NAME, nodes: [], viewTransform: { scale: 1, x: 0, y: 0 }, createdAt: Date.now(), updatedAt: Date.now() }
    activeId.current = projectId
    setActiveProjectId(projectId)
    createdAt.current = next.createdAt
    useStore.setState({ canvasNodes: next.nodes, canvasSelectedNodeIds: [], canvasTransform: next.viewTransform, canvasProjectName: next.name })
    await putActiveCanvasProjectId(projectId)
    if (values) setProjects(values.some((item) => item.id === projectId) ? values : [next, ...values])
    setLoaded(true)
    setStatus(project ? '已恢复 · 自动保存' : '新建工程 · 自动保存')
  }, [])

  const load = useCallback(async () => {
    try {
      const values = await refreshProjects()
      const storedActive = await getActiveCanvasProjectId()
      const projectId = (storedActive && values.some((item) => item.id === storedActive) ? storedActive : values.find((item) => item.id === CANVAS_PROJECT_ID)?.id) ?? CANVAS_PROJECT_ID
      await loadProject(projectId, values)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '恢复失败，请重试')
    }
  }, [loadProject, refreshProjects])

  const switchProject = useCallback(async (projectId: string) => {
    await runOperation('切换工程', async () => {
      if (!loaded || projectId === activeId.current) return
      await save(activeId.current)
      await loadProject(projectId)
      await refreshProjects()
    })
  }, [loaded, loadProject, refreshProjects, runOperation, save])

  const createProject = useCallback(async (projectName = DEFAULT_PROJECT_NAME) => {
    await runOperation('新建工程', async () => {
      if (loaded) await save(activeId.current)
      const projectId = createLocalId('canvas-project')
      await loadProject(projectId, projects)
      useStore.setState({ canvasProjectName: projectName.trim() || DEFAULT_PROJECT_NAME })
      await save(projectId)
      await refreshProjects()
    })
  }, [loadProject, loaded, projects, refreshProjects, runOperation, save])

  const renameProject = useCallback(async (nextName: string) => {
    const value = nextName.trim() || DEFAULT_PROJECT_NAME
    useStore.setState({ canvasProjectName: value })
    try {
      await save(activeId.current)
    } catch (error) {
      console.warn('重命名工程失败', error)
      setStatus('重命名失败，请重试')
      useStore.getState().showToast(error instanceof Error ? error.message : '重命名工程失败', 'error')
    }
  }, [save])

  const removeProject = useCallback(async (projectId?: string) => {
    await runOperation('删除工程', async () => {
      const targetId = projectId ?? activeId.current
      if (projects.length <= 1) {
        if (targetId === activeId.current) await save(targetId)
        if (targetId !== CANVAS_PROJECT_ID) await deleteCanvasProject(targetId)
        activeId.current = CANVAS_PROJECT_ID
        setActiveProjectId(CANVAS_PROJECT_ID)
        createdAt.current = Date.now()
        useStore.setState({ canvasNodes: [], canvasSelectedNodeIds: [], canvasTransform: { scale: 1, x: 0, y: 0 }, canvasProjectName: DEFAULT_PROJECT_NAME })
        await putCanvasProject({ id: CANVAS_PROJECT_ID, name: DEFAULT_PROJECT_NAME, nodes: [], viewTransform: { scale: 1, x: 0, y: 0 }, createdAt: createdAt.current, updatedAt: Date.now() })
        await putActiveCanvasProjectId(CANVAS_PROJECT_ID)
        await refreshProjects()
        return
      }
      const remaining = projects.filter((item) => item.id !== targetId)
      if (targetId === activeId.current) await save(targetId)
      await deleteCanvasProject(targetId)
      if (targetId === activeId.current) await loadProject(remaining[0].id, remaining)
      else setProjects(remaining)
    })
  }, [loadProject, projects, refreshProjects, runOperation, save])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const sync = (event: Event) => {
      const activeProjectId = (event as CustomEvent<{ activeProjectId?: string }>).detail?.activeProjectId
      void runOperation('同步画布工程', async () => {
        const values = await refreshProjects()
        const projectId = activeProjectId && values.some((project) => project.id === activeProjectId)
          ? activeProjectId
          : await getActiveCanvasProjectId() ?? CANVAS_PROJECT_ID
        await loadProject(projectId, values)
      })
    }
    window.addEventListener(CANVAS_PROJECTS_CHANGED_EVENT, sync)
    return () => window.removeEventListener(CANVAS_PROJECTS_CHANGED_EVENT, sync)
  }, [loadProject, refreshProjects, runOperation])

  useEffect(() => {
    if (!loaded) return
    const epoch = projectEpoch.current
    const projectId = activeId.current
    setStatus('有未保存的变更')
    const timer = window.setTimeout(() => {
      if (transitioning.current || epoch !== projectEpoch.current || projectId !== activeId.current) return
      void save(projectId).catch((error) => {
        console.warn('画布自动保存失败', error)
        setStatus('自动保存失败，请重试')
        useStore.getState().showToast(error instanceof Error ? error.message : '画布自动保存失败', 'error')
      })
    }, 800)
    return () => window.clearTimeout(timer)
  }, [loaded, nodes, transform, name, save])

  useEffect(() => {
    if (!loaded) return
    const flush = () => { void save(activeId.current) }
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); void save(activeId.current) }
  }, [loaded, save])

  return { loaded, status, save: () => save(), load, projects, activeProjectId, switchProject, createProject, renameProject, removeProject }
}
