import { useEffect, useCallback } from 'react'
import type { AppMode } from '../types'
import { useStore } from '../store'

export function useHashRouter(defaultRoute: AppMode = 'gallery') {
  const setAppMode = useStore((s) => s.setAppMode)
  const currentRoute = useStore((s) => s.appMode)

  const getPathFromHash = (): AppMode => {
    // 处理可能包含额外参数的 hash，例如 #agent?id=123
    const hash = window.location.hash.replace('#', '').split('?')[0]
    if (hash === 'agent' || hash === 'canvas' || hash === 'gallery') {
      return hash as AppMode
    }
    return defaultRoute
  }

  useEffect(() => {
    const handleHashChange = () => {
      const newMode = getPathFromHash()
      if (newMode !== useStore.getState().appMode) {
        setAppMode(newMode)
      }
    }
    window.addEventListener('hashchange', handleHashChange)
    
    // 如果初始没有 hash，则自动补充默认 hash
    const initialHashMode = getPathFromHash()
    if (!window.location.hash) {
      window.history.replaceState(null, '', `#${defaultRoute}`)
    }
    
    // 初始化时同步 hash 到 store
    if (initialHashMode !== useStore.getState().appMode) {
      setAppMode(initialHashMode)
    }
    // 订阅实际状态，避免首次 render 的 gallery 闭包覆盖 URL 中的 canvas。
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.appMode !== previous.appMode && window.location.hash.split('?')[0] !== `#${state.appMode}`) {
        window.history.replaceState(null, '', `#${state.appMode}`)
      }
    })
    return () => { window.removeEventListener('hashchange', handleHashChange); unsubscribe() }
  }, [defaultRoute, setAppMode])

  const navigate = useCallback((route: AppMode) => {
    window.location.hash = route
  }, [])

  return { currentRoute, navigate }
}
