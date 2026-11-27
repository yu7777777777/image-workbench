import { applyQueuedWorkbenchSettings } from './lib/workbenchSettings'
import { useEffect, useState, Suspense, lazy } from 'react'
import { getActiveAgentConversation, initStore, restoreExplicitPresetConfig, syncWorkbenchDeletions, updateAgentSkill, useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, getExplicitUrlSettingsIds, hasUrlSettingParams } from './lib/urlSettings'
import { createDefaultOpenAIProfile, hasDefaultPresetConfig, isAgentTextApiProfile } from './lib/apiProfiles'
import { getCustomProviderConfigUrl, hasEmbeddedDefaultConfig, loadCustomProviderSettingsFromUrl, loadEmbeddedDefaultConfig } from './lib/customProviderConfigUrl'
import { getDefaultPresetProfileId, getPresetProfileIds, isPresetConfigOnlyEnabled, setPresetConfig } from './lib/presetConfig'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import type { AppSettings } from './types'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
const AgentWorkspace = lazy(() => import('./components/AgentWorkspace'))
import InputBar from './components/InputBar'
const CanvasWorkspace = lazy(() => import('./components/CanvasWorkspace'))
import DetailModal from './components/DetailModal'
import { GalleryAnnotatorHost } from './components/GalleryAnnotatorHost'
import Lightbox from './components/Lightbox'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import SupportPromptModal from './components/SupportPromptModal'
import { FavoriteCollectionPickerModal, FavoriteCollectionsView, ManageCollectionsModal } from './components/FavoriteCollections'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import { ensureSharedProfilesLoaded, isPoolBuild, poolSettings } from './lib/accountPool'
import { getOwnerScopedKey, getWorkbenchOwner, WORKBENCH_PERSIST_BASE_KEY } from './lib/workbenchOwner'
import { useHashRouter } from './hooks/useHashRouter'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider } from './components/ui/Toast'
import { appendCreativeText, fetchCreative, type CanvasCreativeTransfer, type CreativeItem } from './lib/creativeLibrary'
import { normalizeAgentSkill, readAgentSkillMarkdown } from './lib/agentSkill'

let defaultConfigImportStarted = false

export default function App() {
  useHashRouter()
  const appMode = useStore((s) => s.appMode)
  const [canvasCreative, setCanvasCreative] = useState<CanvasCreativeTransfer | null>(null)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const inCollectionOverview = filterFavorite && !activeFavoriteCollectionId
  useDockerApiUrlMigrationNotice()
  useGlobalClickSuppression()

  useEffect(() => {
    if (defaultConfigImportStarted) return
    defaultConfigImportStarted = true

    const searchParams = new URLSearchParams(window.location.search)
    const customProviderConfigUrl = getCustomProviderConfigUrl()
    const embeddedDefaultConfig = hasEmbeddedDefaultConfig()
    const loadDefaultConfig = () => embeddedDefaultConfig
      ? Promise.resolve().then(() => loadEmbeddedDefaultConfig())
      : loadCustomProviderSettingsFromUrl(customProviderConfigUrl)

    const applyUrlSettings = async (selection: Partial<AppSettings> = {}) => {
      await restoreExplicitPresetConfig(getExplicitUrlSettingsIds(searchParams))
      const source = { ...useStore.getState().settings, ...selection }
      return { ...selection, ...buildSettingsFromUrlParams(source, searchParams) }
    }

    const clearAppliedUrlSettings = () => {
      if (!hasUrlSettingParams(searchParams)) return

      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    void initStore()
      .then(async () => {
        const importedSettings = embeddedDefaultConfig || customProviderConfigUrl
          ? await loadDefaultConfig()
          : hasDefaultPresetConfig()
            ? {
                customProviders: [],
                profiles: [{ ...createDefaultOpenAIProfile(), isDefault: true }],
              }
            : null
        setPresetConfig(importedSettings)

        const state = useStore.getState()
        if (importedSettings) {
          await state.setPresetImportedSettings(importedSettings)
        } else if (state.previousPresetConfig) {
          await state.setPresetImportedSettings({ customProviders: [], profiles: [] })
        }

        const syncedState = useStore.getState()
        if (!importedSettings) {
          useStore.setState({ dismissedPresetProfileIds: [], dismissedPresetProviderIds: [] })
          if (syncedState.settings.profiles.some((profile) => profile.isDefault)) {
            syncedState.setSettings({
              profiles: syncedState.settings.profiles.map((profile) => profile.isDefault ? { ...profile, isDefault: undefined } : profile),
            })
          }
        }

        const current = useStore.getState()
        const presetIds = getPresetProfileIds()
        const defaultPresetId = getDefaultPresetProfileId()
        const selection = isPresetConfigOnlyEnabled() ? {
          activeProfileId: presetIds.has(current.settings.activeProfileId)
            ? current.settings.activeProfileId
            : defaultPresetId ?? [...presetIds][0],
          agentTextProfileId: current.settings.agentTextProfileId && presetIds.has(current.settings.agentTextProfileId)
            ? current.settings.agentTextProfileId
            : current.settings.profiles.find((profile) => presetIds.has(profile.id) && isAgentTextApiProfile(profile))?.id ?? null,
          agentImageProfileId: current.settings.agentImageProfileId && presetIds.has(current.settings.agentImageProfileId)
            ? current.settings.agentImageProfileId
            : defaultPresetId ?? [...presetIds][0],
        } : {}
        current.setSettings(await applyUrlSettings(selection))
        if (!isPoolBuild) {
          // 先尝试取回本站共享模型（禁止首帧以「无共享模型」的状态渲染后一直停留）；
          // 拿不到时由 ensureSharedProfilesLoaded 在后台退避重试，不阻塞首屏。
          await Promise.race([
            ensureSharedProfilesLoaded(),
            new Promise((resolve) => setTimeout(resolve, 1500)),
          ])
        }
        clearAppliedUrlSettings()
      })
      .catch(async (error) => {
        console.warn('Failed to import preset config:', error)
        setPresetConfig(null)
        const state = useStore.getState()
        try {
          state.setSettings(await applyUrlSettings())
          clearAppliedUrlSettings()
          if (!isPoolBuild) void ensureSharedProfilesLoaded()
        } catch (error) {
          console.warn('Failed to restore URL settings:', error)
        }
      })
      .finally(() => {
        if (!isPoolBuild) return
        const state = useStore.getState()
        state.setSettings(poolSettings(state.settings, window.location.origin))
        window.parent.postMessage({ type: 'account-pool-mounted' }, window.location.origin)
        void ensureSharedProfilesLoaded()
      })
  }, [])

  useEffect(syncWorkbenchDeletions, [])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  useEffect(() => {
    let pendingCreative: { id: string; controller: AbortController } | undefined
    const syncTheme = (isDark: boolean) => {
      document.documentElement.classList.toggle('dark', isDark)
    }

    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type === 'theme-sync') {
        syncTheme(e.data.theme === 'dark')
      }
      // 管理端发布/停用共享模型后，外层页面会通知 iframe 重新拉取列表并重建配置，
      // 否则常驻 iframe 会一直停留在旧列表上（普通用户因此看不到本站对话模型）。
      if (e.data?.type === 'sync-shared-profiles') {
        void ensureSharedProfilesLoaded()
      }
      if (e.source === window.parent && e.data?.type === 'apply-playground-settings' && e.data.owner === getWorkbenchOwner()) {
        applyQueuedWorkbenchSettings(useStore.getState().setSettings)
      }
      if (!isPoolBuild || e.source !== window.parent || !getWorkbenchOwner().startsWith('admin:')) return
      const { type, requestId, id, mode } = e.data ?? {}
      if (type === 'cancel-creative-item' && pendingCreative?.id === requestId) {
        pendingCreative?.controller.abort()
        pendingCreative = undefined
        setCanvasCreative(null)
      }
      if (type !== 'apply-creative-item' || typeof requestId !== 'string') return
      const finish = () => {
        if (pendingCreative?.id === requestId) pendingCreative = undefined
        window.parent.postMessage({ type: 'creative-item-finished', requestId }, window.location.origin)
      }
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || !['gallery', 'agent', 'canvas'].includes(mode)) {
        useStore.getState().showToast('创意条目链接无效', 'error')
        finish()
        return
      }
      pendingCreative?.controller.abort()
      setCanvasCreative(null)
      const controller = new AbortController()
      pendingCreative = { id: requestId, controller }
      const owner = getWorkbenchOwner()
      const destination = mode === 'agent' && useStore.getState().appMode === 'agent' ? getActiveAgentConversation().id : null
      void fetchCreative<CreativeItem>(`/${id}`, controller.signal).then((item) => {
        if (controller.signal.aborted || owner !== getWorkbenchOwner()) return
        const state = useStore.getState()
        if (state.appMode !== mode || (mode === 'agent' && state.activeAgentConversationId !== destination)) {
          throw new Error('工作区已切换，请重新选择创意条目')
        }
        if (item.kind !== 'prompt' && (item.kind !== 'skill' || mode !== 'agent')) {
          throw new Error('此条目无法用于当前模式')
        }
        if (mode === 'canvas') {
          setCanvasCreative({ item, signal: controller.signal, finish: () => {
            setCanvasCreative((current) => current?.signal === controller.signal ? null : current)
            finish()
          } })
          return
        }
        if (item.kind === 'skill') {
          const { instructions } = readAgentSkillMarkdown(item.content, item.display_title)
          const skill = normalizeAgentSkill({ name: item.display_title, instructions })
          if (!skill) throw new Error('此 Agent 生图技能的内容不符合要求')
          const conversation = state.agentConversations.find(({ id }) => id === destination)
          if (!conversation?.skill || window.confirm(`将当前对话的「${conversation.skill.name}」替换为「${skill.name}」？`)) {
            updateAgentSkill(getActiveAgentConversation().id, skill)
            state.showToast('已挂载到当前对话', 'success')
          }
        } else {
          if (mode === 'gallery' && state.filterFavorite && !state.activeFavoriteCollectionId) state.setFilterFavorite(false)
          state.setPrompt(appendCreativeText(state.prompt, item.content))
          state.showToast('已加入当前输入框', 'success')
        }
        finish()
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return
        useStore.getState().showToast(error instanceof Error ? error.message : '应用条目失败', 'error')
        finish()
      })
    }

    const syncQueuedSettings = (event: StorageEvent) => {
      if (event.key?.startsWith(getOwnerScopedKey(WORKBENCH_PERSIST_BASE_KEY) + ':settings-patch:')) {
        applyQueuedWorkbenchSettings(useStore.getState().setSettings)
      }
    }
    window.addEventListener('message', handleMessage)
    window.addEventListener('storage', syncQueuedSettings)
    return () => {
      pendingCreative?.controller.abort()
      window.removeEventListener('message', handleMessage)
      window.removeEventListener('storage', syncQueuedSettings)
    }
  }, [])

  return (
    <>
      <Header />
      {appMode === 'canvas' ? (
        <ErrorBoundary>
          <Suspense fallback={<div className="flex items-center justify-center h-screen text-gray-400">加载中…</div>}>
            <CanvasWorkspace creativeTransfer={canvasCreative} />
          </Suspense>
        </ErrorBoundary>
      ) : appMode === 'agent' ? (
        <ErrorBoundary>
          <Suspense fallback={<div className="flex items-center justify-center h-screen text-gray-400">加载中…</div>}>
            <div className="studio-agent-shell">
              <AgentWorkspace />
              <InputBar />
            </div>
          </Suspense>
        </ErrorBoundary>
      ) : (
        <main data-home-main data-drag-select-surface className={inCollectionOverview ? "studio-gallery [--input-bar-clearance:0px]" : "studio-gallery"}>
          <div className="safe-area-x w-full px-4 sm:px-6 lg:px-8">
            <SearchBar />
            {inCollectionOverview ? <FavoriteCollectionsView /> : <TaskGrid />}
          </div>
        </main>
      )}
      {appMode === 'gallery' && !inCollectionOverview && <InputBar />}
      <DetailModal />
      <GalleryAnnotatorHost />
      <Lightbox />
      <ConfirmDialog />
      <SupportPromptModal />
      <FavoriteCollectionPickerModal />
      <ManageCollectionsModal />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
      <ToastProvider />
    </>
  )
}
