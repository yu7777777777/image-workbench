import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, exportData, importData, clearData } from '../store'
import HistoryModal from './HistoryModal'
import { EditIcon, HistoryIcon } from './icons'
import Select from './Select'
import { isAgentTextApiProfile } from '../lib/apiProfiles'
import { isPoolBuild } from '../lib/accountPool'

export default function Header() {
  const appMode = useStore((s) => s.appMode)
  const setAppMode = useStore((s) => s.setAppMode)
  const agentMobileHeaderVisible = useStore((s) => s.agentMobileHeaderVisible)
  const activeAgentConversationId = useStore((s) => s.activeAgentConversationId)
  const activeConversationTitle = useStore((s) => s.appMode === 'agent'
    ? s.agentConversations.find((item) => item.id === s.activeAgentConversationId)?.title
    : undefined)
  const [hintVisible, setHintVisible] = useState(false)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const isFirstMount = useRef(true)
  const lastReportedMode = useRef(appMode)
  const createConversation = useStore((s) => s.createAgentConversation)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const agentTextProfiles = useMemo(
    () => settings.profiles.filter(isAgentTextApiProfile),
    [settings.profiles],
  )
  // 与 InputBar 保持一致：不再兜底成账号池 id（账号池已不是文本模型，不在 agentTextProfiles 里）。
  const currentAgentTextProfileId = settings.agentTextProfileId || agentTextProfiles[0]?.id || ''

  useEffect(() => {
    if (appMode === 'agent' && !agentMobileHeaderVisible) {
      setHintVisible(true)
      const timer = setTimeout(() => {
        setHintVisible(false)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [appMode, agentMobileHeaderVisible])

  // 监听来自父页面的控制指令（模式切换、数据导出/导入/清除等）
  useEffect(() => {
    const handleParentMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data
      if (!data || typeof data !== 'object') return

      if (data.type === 'set-app-mode') {
        if (data.mode === 'gallery' || data.mode === 'agent' || data.mode === 'canvas') {
          lastReportedMode.current = data.mode
          useStore.getState().setAppMode(data.mode)
        }
      } else if (data.type === 'export-data-request') {
        try {
          await exportData(data.options ?? { exportConfig: true, exportTasks: true })
          window.parent.postMessage({ type: 'export-data-response', success: true }, window.location.origin)
        } catch (err) {
          window.parent.postMessage({ type: 'export-data-response', success: false, error: String(err) }, window.location.origin)
        }
      } else if (data.type === 'import-data-request') {
        try {
          const success = await importData(data.files, data.options ?? { importConfig: true, importTasks: true })
          window.parent.postMessage({ type: 'import-data-response', success }, window.location.origin)
        } catch (err) {
          window.parent.postMessage({ type: 'import-data-response', success: false, error: String(err) }, window.location.origin)
        }
      } else if (data.type === 'clear-data-request') {
        try {
          await clearData(data.options ?? { clearConfig: true, clearTasks: true })
          window.parent.postMessage({ type: 'clear-data-response', success: true }, window.location.origin)
        } catch (err) {
          window.parent.postMessage({ type: 'clear-data-response', success: false, error: String(err) }, window.location.origin)
        }
      } else if (data.type === 'sync-stored-settings') {
        const stored = window.localStorage.getItem('gpt-image-playground')
        if (stored) {
          try {
            const parsed = JSON.parse(stored)
            if (parsed?.state?.settings) {
              useStore.getState().setSettings(parsed.state.settings)
            }
          } catch {}
        }
      }
    }

    window.addEventListener('message', handleParentMessage)
    return () => window.removeEventListener('message', handleParentMessage)
  }, [])

  // 当 appMode 改变时向父级同步
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false
      return
    }
    if (lastReportedMode.current === appMode) return
    lastReportedMode.current = appMode
    window.parent.postMessage({ type: 'app-mode-sync', mode: appMode }, window.location.origin)
  }, [appMode])

  if (isPoolBuild) return null

  return (
    <>
      {appMode === 'agent' && (
      <header data-no-drag-select className={`studio-header safe-area-top fixed top-0 left-0 right-0 z-40 transition-transform duration-300 ease-in-out ${!agentMobileHeaderVisible ? '-translate-y-full sm:translate-y-0' : 'translate-y-0'}`}>
        <div className="safe-area-x safe-header-inner max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between relative min-h-[44px]">
          <div className="flex-1 min-w-0 pr-2 flex items-center gap-2">
            <div className="flex items-center gap-1 relative">
              <button
                ref={historyButtonRef}
                type="button"
                onClick={() => setShowHistoryModal((visible) => !visible)}
                className="p-1.5 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.04] rounded-lg transition-colors"
                title="历史任务"
              >
                <HistoryIcon className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setAppMode('agent')
                  window.location.hash = 'agent'
                  createConversation()
                }}
                className="p-1.5 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.04] rounded-lg transition-colors"
                title="新对话"
              >
                <EditIcon className="w-5 h-5" />
              </button>
              {activeAgentConversationId && (
                <button
                  type="button"
                  onClick={() => {
                    setShowHistoryModal(true)
                    setTimeout(() => {
                      useStore.getState().setAgentEditingConversationId(activeAgentConversationId)
                    }, 0)
                  }}
                  className="text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 truncate max-w-[120px] ml-1 px-1.5 py-1 rounded hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors"
                >
                  {activeConversationTitle || '新对话'}
                </button>
              )}
              {showHistoryModal && (
                <HistoryModal onClose={() => setShowHistoryModal(false)} ignoreOutsideClickRef={historyButtonRef} />
              )}
            </div>
          </div>
          {agentTextProfiles.length > 0 && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="hidden sm:block text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">对话模型</span>
              <Select
                value={currentAgentTextProfileId}
                onChange={(id) => setSettings({ agentTextProfileId: id })}
                options={agentTextProfiles.map((p) => ({ label: p.name, value: p.id }))}
                showValueTooltips={false}
                className="text-xs rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white/70 dark:bg-white/[0.04] px-2 py-1 text-gray-700 dark:text-gray-300 focus:outline-none hover:border-gray-300 dark:hover:border-white/20 transition-colors min-w-[110px] max-w-[180px]"
              />
            </div>
          )}
        </div>
      </header>
      )}
      
      {/* Hint for sliding down */}
      {appMode === 'agent' && (
      <div className={`fixed top-0 left-0 right-0 z-30 flex justify-center pointer-events-none transition-all duration-300 ease-in-out sm:hidden ${hintVisible && !agentMobileHeaderVisible ? 'translate-y-[env(safe-area-inset-top,0px)] opacity-100' : '-translate-y-full opacity-0'}`}>
        <div className="bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-b-xl shadow-lg">
          下拉展示顶栏
        </div>
      </div>
      )}

      {appMode === 'agent' && (
        <div className={`safe-area-top invisible pointer-events-none transition-all duration-300 ease-in-out ${!agentMobileHeaderVisible ? 'max-h-0 sm:max-h-[500px] opacity-0 sm:opacity-100 overflow-hidden sm:overflow-visible' : 'max-h-[500px] opacity-100'}`} aria-hidden="true">
          <div className="safe-header-inner" />
        </div>
      )}
    </>
  )
}
