import { useRef, useEffect, useCallback, useState, useMemo, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { deleteFavoriteCollection, useStore, submitTask, submitAgentMessage, stopAgentResponse, addImageFromFile, removeMultipleTasks, taskMatchesFilterStatus, taskMatchesSearchQuery } from '../store'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { getActiveAgentRounds } from '../lib/agentConversationState'
import { getActiveApiProfile, getAgentImageApiProfile, isAgentTextApiProfile, normalizeSettings } from '../lib/apiProfiles'
import { ensureSharedProfilesLoaded, isPoolBuild, POOL_AGENT_PROFILE_ID, POOL_KEY, POOL_PROFILE_ID, SHARED_PROFILES_SYNCED_EVENT } from '../lib/accountPool'
// isPoolProfileId 属于叶子模块 poolProfileIds，避免 accountPool 与 apiProfiles 之间的循环依赖
import { isPoolProfileId } from '../lib/poolProfileIds'
import { getImageGenerationModel, isGptImage25Model } from '../lib/imageModels'
import { ensureImageCached, getCachedImage } from '../lib/imageCache'
import { DEFAULT_FAL_IMAGE_SIZE, getChangedParams, getOutputImageLimitForSettings, normalizeParamsForSettings } from '../lib/paramCompatibility'
import { getAtImageQuery, getImageMentionLabel, getPromptIndexFromVisibleIndex, getPromptMentionParts, getSelectedImageMentionLabel, imageMentionMatches, insertImageMentionAtVisibleRange, insertTextMentionAtVisibleRange, isCursorInSelectedImageMention, stripImageMentionMarkers } from '../lib/promptImageMentions'
import { normalizeCodexCliImageSize, normalizeImageSize } from '../lib/size'
import { getInputImageLimit, getInputImageLimitHint } from '../lib/inputImageLimits'
import { createMaskPreviewDataUrl } from '../lib/canvasImage'
import { getSafeBoundingClientRect } from '../lib/domRect'
import { collectAgentRoundOutputImageSlots } from '../lib/agentImageReferences'
import { ALL_FAVORITES_COLLECTION_ID, getTaskFavoriteCollectionIds } from '../lib/favoriteState'
import { getContentEditableCursor, getContentEditablePlainText, getContentEditableSelection, getMentionTagHtml, setContentEditableCursor, setContentEditableSelection, syncMentionTagSelection } from '../lib/contentEditableMentions'
import { useHintTooltip } from '../hooks/useHintTooltip'
import { downloadImageEntriesAsZip, downloadImageIds, formatExportFileTime, getTaskOutputImageZipEntries } from '../lib/downloadImages'
import SizePickerModal from './SizePickerModal'
import { CloseIcon, CollapseIcon, ExpandIcon, HistoryIcon, PlusIcon } from './icons'
import HistoryModal from './HistoryModal'
import ButtonTooltip from './input/buttonTooltip'
import DragUploadOverlay from './input/dragUploadOverlay'
import InputBatchBars from './input/inputBatchBars'
import InputParamsPanel from './input/inputParamsPanel'
import { fetchQuotaData, type QuotaData } from '../lib/quota'
import { fetchAvailableImageModelsResult, filterHiddenImageModels, getCachedAvailableImageModels } from '../lib/modelsCatalog'

/** API 支持的最大参考图数量（超限图片保留并置灰，提交时拦截） */
const API_MAX_IMAGES = getInputImageLimit()

function getFavoriteCollectionTasksForBatch(collectionId: string, tasks: TaskRecord[], defaultFavoriteCollectionId: string | null) {
  const favoriteTasks = tasks.filter((task) => task.isFavorite)
  if (collectionId === ALL_FAVORITES_COLLECTION_ID) return favoriteTasks
  return favoriteTasks.filter((task) => getTaskFavoriteCollectionIds(task, defaultFavoriteCollectionId).includes(collectionId))
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

type AtImageOption =
  | { type: 'input'; key: string; label: string; imageId: string; dataUrl: string; imageIndex: number }
  | { type: 'agent-output'; key: string; label: string; imageId: string; insertText: string }

function agentImageMentionMatches(query: string, label: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  const normalizedLabel = label.toLowerCase()
  return normalizedLabel.includes(normalized) || normalizedLabel.replace(/^@/, '').includes(normalized)
}

function AtImageOptionThumb({ option }: { option: AtImageOption }) {
  const [src, setSrc] = useState(option.type === 'input' ? option.dataUrl : getCachedImage(option.imageId) || '')

  useEffect(() => {
    if (option.type === 'input') {
      setSrc(option.dataUrl)
      return
    }

    let cancelled = false
    setSrc(getCachedImage(option.imageId) || '')
    ensureImageCached(option.imageId).then((url) => {
      if (!cancelled && url) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [option])

  return (
    <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-gray-200/70 bg-gray-100 dark:border-white/[0.08] dark:bg-white/[0.04]">
      {src && <img src={src} className="h-full w-full object-cover" alt="" />}
    </span>
  )
}

export default function InputBar() {
  const prompt = useStore((s) => s.prompt)
  const appMode = useStore((s) => s.appMode)
  const isAgentMode = appMode === 'agent'
  const createConversation = useStore((s) => s.createAgentConversation)
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const closeHistory = useCallback(() => setHistoryOpen(false), [])
  useEffect(closeHistory, [appMode, closeHistory])
  const setPrompt = useStore((s) => s.setPrompt)
  const inputImages = useStore((s) => s.inputImages)
  const addInputImage = useStore((s) => s.addInputImage)
  const removeInputImage = useStore((s) => s.removeInputImage)
  const clearInputImages = useStore((s) => s.clearInputImages)
  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const reusedTaskApiProfileId = useStore((s) => s.reusedTaskApiProfileId)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const selectedFavoriteCollectionIds = useStore((s) => s.selectedFavoriteCollectionIds)
  const setSelectedFavoriteCollectionIds = useStore((s) => s.setSelectedFavoriteCollectionIds)
  const clearFavoriteCollectionSelection = useStore((s) => s.clearFavoriteCollectionSelection)
  const tasks = useStore((s) => s.tasks)
  const favoriteCollections = useStore((s) => s.favoriteCollections)
  const defaultFavoriteCollectionId = useStore((s) => s.defaultFavoriteCollectionId)
  // 画廊中只让任务更新驱动输入栏，后台 Agent 的每段文字无需刷新整块输入 UI。
  const activeAgentConversation = useStore((s) => s.appMode === 'agent'
    ? s.agentConversations.find((conversation) => conversation.id === s.activeAgentConversationId) ?? null
    : null)
  const activeAgentConversationId = useStore((s) => s.activeAgentConversationId)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const openFavoritePicker = useStore((s) => s.openFavoritePicker)
  const searchQuery = useStore((s) => s.searchQuery)

  const filteredTasks = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt)
    const q = searchQuery.trim().toLowerCase()
    
    return sorted.filter((t) => {
      if (filterFavorite) {
        if (!t.isFavorite) return false
        if (activeFavoriteCollectionId && activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID && !getTaskFavoriteCollectionIds(t, defaultFavoriteCollectionId).includes(activeFavoriteCollectionId)) return false
      }
      if (!taskMatchesFilterStatus(t, filterStatus)) return false
      return taskMatchesSearchQuery(t, q)
    })
  }, [tasks, searchQuery, filterStatus, filterFavorite, activeFavoriteCollectionId, defaultFavoriteCollectionId])

  const inCollectionOverview = filterFavorite && !activeFavoriteCollectionId

  const favoriteCollectionCards = useMemo(() => {
    return [
      {
        id: ALL_FAVORITES_COLLECTION_ID,
        name: '全部',
        tasks: getFavoriteCollectionTasksForBatch(ALL_FAVORITES_COLLECTION_ID, tasks, defaultFavoriteCollectionId),
      },
      ...favoriteCollections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        collection,
        tasks: getFavoriteCollectionTasksForBatch(collection.id, tasks, defaultFavoriteCollectionId),
      })),
    ]
  }, [defaultFavoriteCollectionId, favoriteCollections, tasks])

  const filteredFavoriteCollectionCards = useMemo(() => {
    if (!searchQuery.trim()) return favoriteCollectionCards
    const lowerQuery = searchQuery.toLowerCase()
    return favoriteCollectionCards.filter((collection) => collection.name.toLowerCase().includes(lowerQuery))
  }, [favoriteCollectionCards, searchQuery])

  const handleSelectAllVisibleTasks = useCallback(() => {
    setSelectedTaskIds(filteredTasks.map((task) => task.id))
  }, [filteredTasks, setSelectedTaskIds])

  const handleInvertVisibleTasks = useCallback(() => {
    const visibleIds = new Set(filteredTasks.map((task) => task.id))
    setSelectedTaskIds((current) => {
      const currentSet = new Set(current)
      const next = current.filter((id) => !visibleIds.has(id))
      filteredTasks.forEach((task) => {
        if (!currentSet.has(task.id)) next.push(task.id)
      })
      return next
    })
  }, [filteredTasks, setSelectedTaskIds])

  const handleSelectAllVisibleFavoriteCollections = useCallback(() => {
    setSelectedFavoriteCollectionIds(filteredFavoriteCollectionCards.map((collection) => collection.id))
  }, [filteredFavoriteCollectionCards, setSelectedFavoriteCollectionIds])

  const handleInvertVisibleFavoriteCollections = useCallback(() => {
    const visibleIds = new Set(filteredFavoriteCollectionCards.map((collection) => collection.id))
    setSelectedFavoriteCollectionIds((current) => {
      const currentSet = new Set(current)
      const next = current.filter((id) => !visibleIds.has(id))
      filteredFavoriteCollectionCards.forEach((collection) => {
        if (!currentSet.has(collection.id)) next.push(collection.id)
      })
      return next
    })
  }, [filteredFavoriteCollectionCards, setSelectedFavoriteCollectionIds])

  const handleToggleFavorite = useCallback(() => {
    openFavoritePicker(selectedTaskIds)
  }, [openFavoritePicker, selectedTaskIds])

  const handleDeleteSelected = useCallback(() => {
    setConfirmDialog({
      title: '批量删除',
      message: `确定要删除选中的 ${selectedTaskIds.length} 个任务吗？`,
      action: () => {
        removeMultipleTasks(selectedTaskIds)
      },
    })
  }, [selectedTaskIds, setConfirmDialog])

  const handleDownloadSelected = useCallback(async () => {
    const selectedTasks = tasks.filter((t) => selectedTaskIds.includes(t.id))
    const imageIds = selectedTasks.flatMap(t => t.outputImages || [])
    if (imageIds.length === 0) {
      showToast('选中的任务没有图片', 'info')
      return
    }

    try {
      const timeStr = formatExportFileTime(new Date())
      const fileNameBase = `batch-${timeStr}`
      const { successCount, failCount } = settings.zipDownloadRoutes.includes('task-selection')
        ? await downloadImageEntriesAsZip(getTaskOutputImageZipEntries(selectedTasks), fileNameBase)
        : await downloadImageIds(imageIds, fileNameBase)

      if (successCount === 0) {
        showToast('下载失败', 'error')
      } else if (failCount > 0) {
        showToast(`部分下载失败：成功 ${successCount}，失败 ${failCount}`, 'error')
      } else {
        showToast(successCount > 1 ? `下载成功：${successCount} 张图片` : '下载成功', 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
    clearSelection()
  }, [tasks, selectedTaskIds, settings.zipDownloadRoutes, showToast, clearSelection])

  const handleDownloadSelectedFavoriteCollections = useCallback(async () => {
    const selectedIdSet = new Set(selectedFavoriteCollectionIds)
    const selectedCollections = favoriteCollectionCards.filter((collection) => selectedIdSet.has(collection.id))
    if (selectedCollections.length === 0) return

    let successCount = 0
    let failCount = 0
    let downloadedCollectionCount = 0
    const useZipDownload = settings.zipDownloadRoutes.includes('favorite-collection-selection')
    const timeStr = formatExportFileTime(new Date())

    try {
      for (const collection of selectedCollections) {
        const entries = getTaskOutputImageZipEntries(collection.tasks)
        if (entries.length === 0) continue
        const zipName = collection.id === ALL_FAVORITES_COLLECTION_ID
          ? `favorites-all-${timeStr}`
          : `favorites-${collection.name}-${timeStr}`
        const result = useZipDownload
          ? await downloadImageEntriesAsZip(entries, zipName)
          : await downloadImageIds(entries.map((entry) => entry.imageId), zipName)
        successCount += result.successCount
        failCount += result.failCount
        if (result.successCount > 0) downloadedCollectionCount++
        if (selectedCollections.length > 1) await delay(100)
      }

      if (successCount === 0) {
        showToast('选中的收藏夹没有图片', 'info')
      } else if (failCount > 0) {
        showToast(`部分下载失败：成功 ${successCount}，失败 ${failCount}`, 'error')
      } else {
        showToast(useZipDownload && downloadedCollectionCount > 1 ? `下载成功：${downloadedCollectionCount} 个压缩包，${successCount} 张图片` : `下载成功：${successCount} 张图片`, 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
    clearFavoriteCollectionSelection()
  }, [clearFavoriteCollectionSelection, favoriteCollectionCards, selectedFavoriteCollectionIds, settings.zipDownloadRoutes, showToast])

  const handleDeleteSelectedFavoriteCollections = useCallback(() => {
    const selectedIdSet = new Set(selectedFavoriteCollectionIds)
    const selectedCollections = favoriteCollections.filter((collection) => selectedIdSet.has(collection.id))
    if (selectedCollections.length === 0) {
      showToast('没有可删除的收藏夹', 'info')
      return
    }
    if (favoriteCollections.length - selectedCollections.length < 1) {
      showToast('至少保留一个收藏夹', 'error')
      return
    }

    const selectedCollectionIds = new Set(selectedCollections.map((collection) => collection.id))
    const imageCount = new Set(
      tasks
        .filter((task) => getTaskFavoriteCollectionIds(task, defaultFavoriteCollectionId).some((id) => selectedCollectionIds.has(id)))
        .flatMap((task) => task.outputImages || []),
    ).size
    setConfirmDialog({
      title: '批量删除收藏夹',
      message: `确定要删除选中的 ${selectedCollections.length} 个收藏夹吗？`,
      checkbox: imageCount > 0
        ? {
            label: `同时删除收藏夹中的图片（${imageCount} 张）`,
            tone: 'danger',
          }
        : undefined,
      action: async (deleteImages = false) => {
        for (const collection of selectedCollections) {
          await deleteFavoriteCollection(collection.id, deleteImages)
        }
        clearFavoriteCollectionSelection()
      },
    })
  }, [clearFavoriteCollectionSelection, defaultFavoriteCollectionId, favoriteCollections, selectedFavoriteCollectionIds, setConfirmDialog, showToast, tasks])

  const maskDraft = useStore((s) => s.maskDraft)
  const moveInputImage = useStore((s) => s.moveInputImage)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const imagesRef = useRef<HTMLDivElement>(null)
  const prevHeightRef = useRef(42)

  const [isDragging, setIsDragging] = useState(false)
  const [isSingleLine, setIsSingleLine] = useState(true)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [promptExpandedTop, setPromptExpandedTop] = useState(0)
  const [promptCanExpand, setPromptCanExpand] = useState(false)
  const [clearPromptHover, setClearPromptHover] = useState(false)
  const [expandPromptHover, setExpandPromptHover] = useState(false)
  const [submitHover, setSubmitHover] = useState(false)
  const [attachHover, setAttachHover] = useState(false)
  const [imageHintId, setImageHintId] = useState<string | null>(null)
  const [mobileCollapsed, setMobileCollapsed] = useState(true)
  const [showSizePicker, setShowSizePicker] = useState(false)
  const [showMobileUploadMenu, setShowMobileUploadMenu] = useState(false)
  const [maskPreviewUrl, setMaskPreviewUrl] = useState('')
  const [imageDragIndex, setImageDragIndex] = useState<number | null>(null)
  const [imageDragOverIndex, setImageDragOverIndex] = useState<number | null>(null)
  const [atImageMenuIndex, setAtImageMenuIndex] = useState(0)
  const [atImageMenuDismissed, setAtImageMenuDismissed] = useState(false)
  const [touchDragPreview, setTouchDragPreview] = useState<{ src: string; x: number; y: number } | null>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const dragTouchRef = useRef({ startY: 0, moved: false })
  const suppressHandleClickUntilRef = useRef(0)
  const imageDragIndexRef = useRef<number | null>(null)
  const imageTouchDragRef = useRef({ index: null as number | null, startX: 0, startY: 0, moved: false })
  const imageDragOverIndexRef = useRef<number | null>(null)
  const imageDragPreviewRef = useRef<HTMLElement | null>(null)
  const suppressImageClickRef = useRef(false)
  const isUserInputRef = useRef(false)
  const isComposingRef = useRef(false)
  const imageHintLockedRef = useRef(false)
  const imageHintReleaseRef = useRef<(() => void) | null>(null)
  const [cursorPos, setCursorPos] = useState(0)
  const [menuLeft, setMenuLeft] = useState(0)
  const showPromptExpand = promptExpanded || promptCanExpand

  const updateInputBarClearance = useCallback(() => {
    const bar = cardRef.current?.closest<HTMLElement>('[data-input-bar]')
    if (!bar) return

    const rect = bar.getBoundingClientRect()
    const clearance = Math.max(0, window.innerHeight - rect.top)
    document.documentElement.style.setProperty('--input-bar-clearance', `${Math.ceil(clearance)}px`)
  }, [])

  useLayoutEffect(() => {
    if (isAgentMode) {
      document.documentElement.style.removeProperty('--input-bar-clearance')
      return
    }
    const bar = cardRef.current?.closest<HTMLElement>('[data-input-bar]')
    if (!bar) return

    const frame = window.requestAnimationFrame(updateInputBarClearance)
    const observer = new ResizeObserver(updateInputBarClearance)
    observer.observe(bar)

    const visualViewport = window.visualViewport
    window.addEventListener('resize', updateInputBarClearance)
    visualViewport?.addEventListener('resize', updateInputBarClearance)
    visualViewport?.addEventListener('scroll', updateInputBarClearance)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', updateInputBarClearance)
      visualViewport?.removeEventListener('resize', updateInputBarClearance)
      visualViewport?.removeEventListener('scroll', updateInputBarClearance)
      document.documentElement.style.removeProperty('--input-bar-clearance')
    }
  }, [isAgentMode, updateInputBarClearance])

  useLayoutEffect(() => {
    if (!promptExpanded) return

    const header = document.querySelector<HTMLElement>('header')
    if (!header) return

    const updateTop = () => setPromptExpandedTop(Math.max(0, header.getBoundingClientRect().bottom) + 8)
    const observer = new ResizeObserver(updateTop)
    observer.observe(header)
    updateTop()
    window.addEventListener('resize', updateTop)
    header.addEventListener('transitionend', updateTop)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateTop)
      header.removeEventListener('transitionend', updateTop)
    }
  }, [promptExpanded])
  const imageHintTimerRef = useRef<number | null>(null)
  const [outputCompressionInput, setOutputCompressionInput] = useState(
    params.output_compression == null ? '' : String(params.output_compression),
  )
  const [nInput, setNInput] = useState(String(params.n))
  const [nInputFocused, setNInputFocused] = useState(false)
  const dragCounter = useRef(0)
  const isMobile = useIsMobile()

  const settingsActiveProfile = useMemo(() => getActiveApiProfile(settings), [settings])
  const currentActiveProfile = useMemo(() => (
    appMode === 'agent'
      ? getAgentImageApiProfile(settings) ?? settingsActiveProfile
      : settingsActiveProfile
  ), [appMode, settings, settingsActiveProfile])
  const activeProfile = useMemo(() => (
    appMode !== 'agent' && settings.reuseTaskApiProfileTemporarily && reusedTaskApiProfileId
      ? settings.profiles.find((profile) => profile.id === reusedTaskApiProfileId) ?? currentActiveProfile
      : currentActiveProfile
  ), [appMode, currentActiveProfile, reusedTaskApiProfileId, settings])
  const activeAgentIsRunning = Boolean(activeAgentConversation?.rounds.some((round) => round.status === 'running'))
  // 应用启动时若共享模型列表比首帧渲染更晚到位，普通用户会看到「对话模型」下拉框凭空空掉；
  // 这里在 Agent 模式下发现列表为空时补拉一次，并监听同步事件以便列表到位后立刻重渲染。
  const hasAgentTextProfiles = settings.profiles.some(isAgentTextApiProfile)
  const [, setSharedProfilesSyncTick] = useState(0)
  useEffect(() => {
    const handleSynced = () => setSharedProfilesSyncTick((tick) => tick + 1)
    window.addEventListener(SHARED_PROFILES_SYNCED_EVENT, handleSynced)
    // 轮询必须有上限：站点确实没有共享对话模型时列表永远为空，
    // 无上限的 interval 会让客户端每 3 秒打一次 /api/shared-profiles 并反复重建配置。
    let ticks = 0
    const MAX_POLL_TICKS = 10
    let timer: number | null = appMode === 'agent' && !hasAgentTextProfiles
      ? window.setInterval(() => {
        ticks += 1
        if (ticks >= MAX_POLL_TICKS) {
          if (timer !== null) window.clearInterval(timer)
          timer = null
          return
        }
        void ensureSharedProfilesLoaded()
      }, 3000)
      : null
    if (timer !== null) void ensureSharedProfilesLoaded()
    return () => {
      window.removeEventListener(SHARED_PROFILES_SYNCED_EVENT, handleSynced)
      if (timer !== null) window.clearInterval(timer)
    }
  }, [appMode, hasAgentTextProfiles])
  // 对话模型包含本站账号池 (Agent)，默认就选它；第三方 Responses 配置排在其后供手动切换。
  const agentTextProfiles = useMemo(
    () => settings.profiles.filter(isAgentTextApiProfile),
    [settings.profiles],
  )
  // 不再兜底成账号池 id：账号池 (Agent) 已在 agentTextProfiles 里，兜底会让下拉框显示列表外的值。
  const currentAgentTextProfileId = settings.agentTextProfileId
    || agentTextProfiles[0]?.id
    || ''
  // 生图模型：排除除「生图账号池」以外的所有 pool profile，账号池 (Agent) 只作对话模型。
  const agentImageProfiles = useMemo(
    () => settings.profiles.filter((p) => !isAgentTextApiProfile(p) && p.id !== POOL_AGENT_PROFILE_ID),
    [settings.profiles],
  )
  const currentAgentImageProfileId = settings.agentImageProfileId || POOL_PROFILE_ID
  const effectiveSettings = useMemo(() => (
    activeProfile.id === settingsActiveProfile.id
      ? settings
      : normalizeSettings({ ...settings, activeProfileId: activeProfile.id })
  ), [activeProfile.id, settingsActiveProfile.id, settings])

  const [quotaData, setQuotaData] = useState<QuotaData | null>(null)
  // 账号池目录独立于当前所选配置。切换模型时沿用已确认的目录。
  const catalogApiKey = isPoolBuild ? undefined : activeProfile.apiKey
  const catalogBaseUrl = isPoolBuild ? undefined : activeProfile.baseUrl
  const catalogProxy = isPoolBuild ? undefined : activeProfile.apiProxy
  const [imageCatalog, setImageCatalog] = useState(() => {
    const cached = getCachedAvailableImageModels(catalogApiKey, catalogBaseUrl, catalogProxy)
    return {
      models: filterHiddenImageModels(cached ?? (isPoolBuild ? [] : ['gpt-image-2'])),
      status: isPoolBuild && !cached?.length ? 'loading' : 'ready',
    }
  })
  const availableModels = imageCatalog.models
  const poolProfileAvailable = settings.profiles.some((profile) => profile.id === POOL_PROFILE_ID)
  const showImageModelControl = isPoolBuild || agentImageProfiles.length > 0 || availableModels.length > 0

  const isPoolProfile = isPoolProfileId(activeProfile.id)
  const isSharedProfile = activeProfile.id.startsWith('shared-')

  const selectedModel = activeProfile.model || 'gpt-image-2'
  const currentModelQuota = useMemo(() => {
    if (!isPoolProfile || !quotaData) return null
    if (quotaData.quotaByModel && typeof quotaData.quotaByModel[selectedModel] === 'number') {
      return quotaData.quotaByModel[selectedModel]
    }
    return quotaData.totalQuota
  }, [isPoolProfile, quotaData, selectedModel])

  const refreshQuota = useCallback(async () => {
    const data = await fetchQuotaData()
    if (data !== null) setQuotaData(data)
  }, [])

  useEffect(() => {
    void refreshQuota()
  }, [refreshQuota])

  useEffect(() => {
    const handleFocus = () => {
      void refreshQuota()
      // 管理端随时可能发布/停用共享模型，回到页面时重新拉取一次，保证普通用户看到最新列表。
      void ensureSharedProfilesLoaded()
    }
    window.addEventListener('focus', handleFocus)
    const interval = window.setInterval(refreshQuota, 30000)
    return () => {
      window.removeEventListener('focus', handleFocus)
      window.clearInterval(interval)
    }
  }, [refreshQuota])

  useEffect(() => {
    let active = true
    let pending = false
    const refreshModels = async () => {
      if (pending) return
      pending = true
      try {
        const result = await fetchAvailableImageModelsResult(catalogApiKey, catalogBaseUrl, catalogProxy)
        if (!active) return
        const cached = getCachedAvailableImageModels(catalogApiKey, catalogBaseUrl, catalogProxy)
        setImageCatalog({
          models: filterHiddenImageModels(result.ok ? result.models : cached ?? result.models),
          status: result.ok || cached?.length || !isPoolBuild ? 'ready' : 'error',
        })
      } finally {
        pending = false
      }
    }
    void refreshModels()
    if (!isPoolBuild) return () => { active = false }
    window.addEventListener('focus', refreshModels)
    const timer = window.setInterval(refreshModels, 30_000)
    return () => {
      active = false
      window.removeEventListener('focus', refreshModels)
      window.clearInterval(timer)
    }
  }, [catalogApiKey, catalogBaseUrl, catalogProxy])

  const runningTaskCount = useMemo(() => tasks.filter((t) => t.status === 'running').length, [tasks])
  const prevRunningCountRef = useRef(runningTaskCount)
  useEffect(() => {
    if (prevRunningCountRef.current > 0 && runningTaskCount === 0) {
      void refreshQuota()
    }
    prevRunningCountRef.current = runningTaskCount
  }, [runningTaskCount, refreshQuota])

  const handleModelChange = useCallback((model: string, explicitProfileId?: string) => {
    const targetProfileId = explicitProfileId || (isPoolBuild && availableModels.includes(model)
      ? POOL_PROFILE_ID
      : activeProfile.id.startsWith('shared-')
        ? settings.profiles.find((profile) => !profile.id.startsWith('shared-') && !isAgentTextApiProfile(profile))?.id ?? activeProfile.id
        : activeProfile.id)
    const updatedProfiles = settings.profiles.map((p) =>
      p.id === targetProfileId ? { ...p, model, imageGenerationModel: model } : p
    )
    setSettings({
      profiles: updatedProfiles,
      ...(appMode === 'agent' ? { agentImageProfileId: targetProfileId } : { activeProfileId: targetProfileId }),
    })
  }, [activeProfile.id, appMode, availableModels, settings.profiles, setSettings])

  const hasSubmitApiConfig = Boolean(activeProfile.apiKey)
  // 遮罩草稿本身就是一次编辑指令（提交时由 store 落成 mask 文件），允许无提示词直接提交；
  // 评论锚点/标注笔迹只存在于画布节点上，画布走 submitTask({ input }) 且不经过 InputBar，
  // 因此这里只需要放行遮罩草稿这一种「无提示词编辑」草稿。
  const hasMaskEditDraft = Boolean(maskDraft)
  const canUseImageModel = !isPoolBuild || !isPoolProfile || availableModels.includes(selectedModel)
  const canSubmit = Boolean((prompt.trim() || hasMaskEditDraft) && hasSubmitApiConfig && !activeAgentIsRunning
    && (isAgentMode || canUseImageModel))
  const submitButtonAriaLabel = activeAgentIsRunning
    ? '停止生成'
    : hasSubmitApiConfig
    ? appMode === 'agent' ? '发送' : maskDraft ? '遮罩编辑' : '生成图像'
    : '请先配置 API'
  const submitTooltipText = activeAgentIsRunning ? '停止生成' : '尚未完成 API 配置，请在右上角设置中进行'
  const promptPlaceholder = appMode === 'agent' ? '输入消息，@ 引用图片' : '描述画面，@ 引用参考图'
  const submitCurrentMode = useCallback(() => {
    if (appMode === 'agent') {
      void submitAgentMessage()
    } else {
      void submitTask()
    }
  }, [appMode])
  const stopActiveAgentResponse = useCallback(() => {
    stopAgentResponse(activeAgentConversationId)
  }, [activeAgentConversationId])
  const syncPromptFromContentEditable = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    isUserInputRef.current = true
    const range = getContentEditableSelection(el)
    setCursorPos(range.start)
    syncMentionTagSelection(el)
    setPrompt(getContentEditablePlainText(el))
  }, [setPrompt])
  const activeProvider = activeProfile.provider
  const isFalProvider = activeProvider === 'fal'
  const agentAutoImageCount = appMode === 'agent'
  const moderationDisabled = isFalProvider
  const transparentOutputAvailable = appMode === 'gallery'
  const showTransparentOutputControl = transparentOutputAvailable && (params.output_format === 'png' || params.output_format === 'webp')
  const transparentOutputEnabled = transparentOutputAvailable && showTransparentOutputControl && params.transparent_output
  const compressionDisabled = params.output_format === 'png' || isFalProvider
  const outputImageLimit = getOutputImageLimitForSettings(effectiveSettings)
  const isFalTextToImage = isFalProvider && inputImages.length === 0
  const nDraftValue = Number(nInput)
  const effectiveNValue = Number.isNaN(nDraftValue) ? params.n : nDraftValue
  const streamConcurrentByN = activeProfile.provider === 'openai' && activeProfile.streamImages === true && !agentAutoImageCount && effectiveNValue > 1
  const nLimitHintText = agentAutoImageCount
    ? 'Agent 模式下数量由模型根据提示词自动决定'
    : isFalProvider
    ? `fal.ai 最大请求数量为 ${outputImageLimit}`
    : `OpenAI 最大请求数量为 ${outputImageLimit}`
  const rawDisplaySize = isFalTextToImage && params.size === 'auto'
    ? DEFAULT_FAL_IMAGE_SIZE
    : (activeProfile.codexCli ? normalizeCodexCliImageSize(params.size) : normalizeImageSize(params.size)) || DEFAULT_PARAMS.size
  const displaySize = rawDisplaySize === 'auto' ? '自动' : rawDisplaySize

  const qualityOptions = [
    ...(!isFalProvider ? [{ label: '自动', value: 'auto' }] : []),
    { label: '低', value: 'low' },
    { label: '中', value: 'medium' },
    { label: '高', value: 'high' },
    ...(isGptImage25Model(getImageGenerationModel(activeProfile))
      ? [
          { label: '极高', value: 'xhigh' },
          { label: '最高', value: 'max' },
        ]
      : []),
  ]
  const atImageLimit = inputImages.length > API_MAX_IMAGES
  const uploadImageTooltipText = atImageLimit
    ? getInputImageLimitHint(API_MAX_IMAGES)
    : '上传图片'
  const transparentOutputHint = useHintTooltip()
  const handleTransparentOutputMenuOpenChange = useCallback((open: boolean) => {
    if (open) transparentOutputHint.hide()
  }, [transparentOutputHint.hide])
  const compressionHint = useHintTooltip({ enabled: () => compressionDisabled })
  const moderationHint = useHintTooltip({ enabled: () => moderationDisabled })
  const sizeHint = useHintTooltip({ enabled: () => isFalTextToImage || activeProfile.codexCli })
  const qualityHint = useHintTooltip({ enabled: () => activeProfile.codexCli || isFalProvider })
  const nLimitHint = useHintTooltip({ autoHideMs: 2000 })
  const streamConcurrentHint = useHintTooltip({ enabled: () => streamConcurrentByN })
  const maskTargetImage = maskDraft
    ? inputImages.find((img) => img.id === maskDraft.targetImageId) ?? null
    : null
  const referenceImages = maskTargetImage
    ? inputImages.filter((img) => img.id !== maskTargetImage.id)
    : inputImages
  const cursorPosition = cursorPos
  const visiblePrompt = stripImageMentionMarkers(prompt)
  const agentOutputImageOptions = useMemo<AtImageOption[]>(() => {
    if (!activeAgentConversation) return []
    return getActiveAgentRounds(activeAgentConversation).flatMap((round) =>
      collectAgentRoundOutputImageSlots(round, tasks).flatMap((imageId, imageIndex) => {
        if (!imageId) return []
        const label = `@第${round.index}轮图${imageIndex + 1}`
        return {
          type: 'agent-output' as const,
          key: `agent-output:${round.id}:${imageIndex}:${imageId}`,
          label,
          imageId,
          insertText: label,
        }
      }),
    )
  }, [activeAgentConversation, tasks])
  const atImageSourceCount = inputImages.length + agentOutputImageOptions.length
  const atImageQuery = isCursorInSelectedImageMention(prompt, cursorPosition)
    ? null
    : getAtImageQuery(visiblePrompt, cursorPosition, { length: atImageSourceCount })
  const atImageOptions = atImageQuery
    ? [
        ...inputImages
          .map((img, index) => ({
            type: 'input',
            key: `input:${img.id}:${index}`,
            label: getImageMentionLabel(index),
            imageId: img.id,
            dataUrl: img.dataUrl,
            imageIndex: index,
          } satisfies AtImageOption))
          .filter((option) => imageMentionMatches(atImageQuery.query, option.imageIndex)),
        ...agentOutputImageOptions.filter((option) => agentImageMentionMatches(atImageQuery.query, option.label)),
      ]
    : []
  const showAtImageMenu = !atImageMenuDismissed && atImageOptions.length > 0





  const selectAtImageOption = useCallback((option: AtImageOption) => {
    const el = textareaRef.current
    const cursor = el ? getContentEditableCursor(el) : prompt.length
    const query = getAtImageQuery(stripImageMentionMarkers(prompt), cursor, { length: atImageSourceCount })
    setAtImageMenuDismissed(true)
    setAtImageMenuIndex(0)
    if (!query) return

    const mentionText = option.type === 'input' ? getImageMentionLabel(option.imageIndex) : option.insertText
    const nextCursor = query.start + mentionText.length
    if (el) {
      el.focus()
      setContentEditableSelection(el, query.start, cursor)
      if (document.execCommand('insertHTML', false, getMentionTagHtml(mentionText))) {
        setContentEditableCursor(el, nextCursor)
        syncPromptFromContentEditable()
        return
      }
    }

    const next = option.type === 'input'
      ? insertImageMentionAtVisibleRange(prompt, query.start, cursor, option.imageIndex)
      : insertTextMentionAtVisibleRange(prompt, query.start, cursor, option.insertText)
    isUserInputRef.current = false
    setPrompt(next.prompt)
    window.setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        setContentEditableCursor(textareaRef.current, next.cursor)
      }
    }, 0)
  }, [atImageSourceCount, prompt, setPrompt, syncPromptFromContentEditable])



  const insertPromptTextAtSelection = useCallback((text: string) => {
    const el = textareaRef.current
    // 换行文本改用 state 渲染以避免 execCommand 插入 <br>/<div> 导致高度和换行异常
    if (el && !text.includes('\n')) {
      el.focus()
      if (document.execCommand('insertText', false, text)) {
        syncPromptFromContentEditable()
        return
      }
    }

    const selection = el ? getContentEditableSelection(el) : { start: prompt.length, end: prompt.length }
    const promptStart = getPromptIndexFromVisibleIndex(prompt, selection.start)
    const promptEnd = getPromptIndexFromVisibleIndex(prompt, selection.end)
    const nextPrompt = `${prompt.slice(0, promptStart)}${text}${prompt.slice(promptEnd)}`
    const nextCursor = selection.start + text.length
    isUserInputRef.current = false
    setPrompt(nextPrompt)
    window.setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        setContentEditableCursor(textareaRef.current, nextCursor)
      }
    }, 0)
  }, [prompt, setPrompt, syncPromptFromContentEditable])

  const handleClearPrompt = useCallback(() => {
    isUserInputRef.current = false
    setPrompt('')
    if (textareaRef.current) {
      textareaRef.current.innerHTML = ''
      textareaRef.current.focus()
    }
  }, [setPrompt])

  useEffect(() => {
    setOutputCompressionInput(
      params.output_compression == null ? '' : String(params.output_compression),
    )
  }, [params.output_compression])

  useEffect(() => {
    setNInput(agentAutoImageCount ? '自动' : String(params.n))
  }, [agentAutoImageCount, params.n])

  useEffect(() => {
    const normalizedParams = normalizeParamsForSettings(params, effectiveSettings, { hasInputImages: inputImages.length > 0 })
    const patch = getChangedParams(params, normalizedParams)
    if (Object.keys(patch).length) {
      setParams(patch)
    }
  }, [inputImages.length, params, effectiveSettings, setParams])

  useEffect(() => () => {
    if (imageHintTimerRef.current != null) {
      window.clearTimeout(imageHintTimerRef.current)
    }
    imageHintReleaseRef.current?.()
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!maskDraft || !maskTargetImage) {
      setMaskPreviewUrl('')
      return
    }

    createMaskPreviewDataUrl(maskTargetImage.dataUrl, maskDraft.maskDataUrl)
      .then((url) => {
        if (!cancelled) setMaskPreviewUrl(url)
      })
      .catch(() => {
        if (!cancelled) setMaskPreviewUrl('')
      })

    return () => {
      cancelled = true
    }
  }, [maskDraft, maskTargetImage?.id, maskTargetImage?.dataUrl])

  const commitOutputCompression = useCallback(() => {
    if (outputCompressionInput.trim() === '') {
      setOutputCompressionInput('')
      setParams({ output_compression: null })
      return
    }

    const nextValue = Number(outputCompressionInput)
    if (Number.isNaN(nextValue)) {
      setOutputCompressionInput(params.output_compression == null ? '' : String(params.output_compression))
      return
    }

    setOutputCompressionInput(String(nextValue))
    setParams({ output_compression: nextValue })
  }, [outputCompressionInput, params.output_compression, setParams])

  const commitN = useCallback(() => {
    nLimitHint.hide()
    if (agentAutoImageCount) {
      setNInput('自动')
      return
    }
    const nextValue = Number(nInput)
    const normalizedValue =
      nInput.trim() === '' ? DEFAULT_PARAMS.n : Number.isNaN(nextValue) ? params.n : nextValue
    const clampedValue = Math.min(outputImageLimit, Math.max(1, normalizedValue))
    setNInput(String(clampedValue))
    setParams({ n: clampedValue })
  }, [agentAutoImageCount, nInput, nLimitHint, outputImageLimit, params.n, setParams])

  const showNLimitHint = useCallback(() => {
    nLimitHint.show()
  }, [nLimitHint])

  const hideNLimitHint = useCallback(() => {
    nLimitHint.hide()
  }, [nLimitHint])

  const showAgentNHint = useCallback(() => {
    if (agentAutoImageCount) showNLimitHint()
  }, [agentAutoImageCount, showNLimitHint])

  const clearAgentNHintTouchTimer = useCallback(() => {
    nLimitHint.clearTimer()
  }, [nLimitHint])

  const startAgentNHintTouch = useCallback(() => {
    if (!agentAutoImageCount) return
    nLimitHint.startTouch()
  }, [agentAutoImageCount, nLimitHint])

  const handleNInputChange = useCallback((value: string) => {
    if (agentAutoImageCount) {
      setNInput('自动')
      return
    }
    setNInput(value)
    const nextValue = Number(value)
    if (!Number.isNaN(nextValue) && nextValue > outputImageLimit) {
      showNLimitHint()
    } else {
      hideNLimitHint()
    }
  }, [agentAutoImageCount, hideNLimitHint, outputImageLimit, showNLimitHint])

  const handleNLimitIncreaseAttempt = useCallback((preventDefault: () => void) => {
    if (agentAutoImageCount) {
      preventDefault()
      showNLimitHint()
      return
    }
    const currentValue = Number(nInput)
    const effectiveValue = Number.isNaN(currentValue) ? params.n : currentValue
    if (!nInputFocused || effectiveValue < outputImageLimit) return

    preventDefault()
    showNLimitHint()
  }, [agentAutoImageCount, nInput, nInputFocused, outputImageLimit, params.n, showNLimitHint])

  const clearImageHintTimer = () => {
    if (imageHintTimerRef.current != null) {
      window.clearTimeout(imageHintTimerRef.current)
      imageHintTimerRef.current = null
    }
  }

  const showImageHint = (id: string) => setImageHintId(id)

  const hideImageHint = () => {
    if (imageHintLockedRef.current) return
    setImageHintId(null)
    clearImageHintTimer()
  }

  const hideLockedImageHint = () => {
    imageHintLockedRef.current = false
    imageHintReleaseRef.current?.()
    imageHintReleaseRef.current = null
    setImageHintId(null)
    clearImageHintTimer()
  }

  const showImageHintUntilRelease = (id: string) => {
    if (imageHintLockedRef.current) {
      setImageHintId(id)
      return
    }
    imageHintLockedRef.current = true
    setImageHintId(id)
    const release = () => {
      window.removeEventListener('mouseup', release)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('dragend', release)
      if (imageHintReleaseRef.current === release) {
        imageHintReleaseRef.current = null
        imageHintLockedRef.current = false
        setImageHintId(null)
        clearImageHintTimer()
      }
    }
    imageHintReleaseRef.current = release
    window.addEventListener('mouseup', release)
    window.addEventListener('pointerup', release)
    window.addEventListener('dragend', release)
  }

  const handleFiles = async (files: FileList | File[]) => {
    try {
      // 超限图片允许添加，会保留并置灰，提交时统一拦截
      const accepted = Array.from(files).filter((f) => f.type.startsWith('image/'))
      for (const file of accepted) {
        await addImageFromFile(file)
      }
    } catch (err) {
      useStore.getState().showToast(
        `图片添加失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
      )
    }
  }

  const handleFilesRef = useRef(handleFiles)
  handleFilesRef.current = handleFiles

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await handleFilesRef.current(e.target.files || [])
    e.target.value = ''
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // 兼容某些输入法：用 Enter 确认候选字时会额外派发 Enter keydown，
    // 组字期间忽略该事件，避免重复插入或误触发提交/换行。
    if (e.key === 'Enter' && (e.nativeEvent.isComposing || isComposingRef.current || e.nativeEvent.keyCode === 229)) {
      return
    }

    if (showAtImageMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAtImageMenuIndex((idx) => (idx + 1) % atImageOptions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAtImageMenuIndex((idx) => (idx - 1 + atImageOptions.length) % atImageOptions.length)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        selectAtImageOption(atImageOptions[atImageMenuIndex] ?? atImageOptions[0])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAtImageMenuIndex(0)
        textareaRef.current?.blur()
        return
      }
    }

    // 阻止 contentEditable 默认换行
    if (e.key === 'Enter') {
      e.preventDefault()

      const isModifier = e.ctrlKey || e.metaKey

      if (settings.enterSubmit) {
        if (e.shiftKey) {
          insertPromptTextAtSelection('\n')
        } else if (!isModifier) {
          if (canSubmit) submitCurrentMode()
        }
      } else {
        if (isModifier) {
          if (canSubmit) submitCurrentMode()
        } else {
          insertPromptTextAtSelection('\n')
        }
      }
      return
    }
  }

  const handlePromptPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    if (Array.from(e.clipboardData.items).some((item) => item.type.startsWith('image/'))) return

    e.preventDefault()
    insertPromptTextAtSelection(text.replace(/\r\n?/g, '\n'))
  }

  const handlePromptCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const el = textareaRef.current
    if (!el) return

    const selection = getContentEditableSelection(el)
    if (selection.start === selection.end) return

    const promptStart = getPromptIndexFromVisibleIndex(prompt, selection.start)
    const promptEnd = getPromptIndexFromVisibleIndex(prompt, selection.end)
    const text = stripImageMentionMarkers(prompt.slice(promptStart, promptEnd))
    const copyText = /^\s*@图\d+\s*$/.test(text) ? text.trim() : text

    e.preventDefault()
    e.clipboardData.setData('text/plain', copyText)
  }

  // 粘贴图片
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imageFiles: File[] = []
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) imageFiles.push(file)
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault()
        handleFilesRef.current(imageFiles)
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  // 拖拽图片 - 监听整个页面
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current++
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDragging(true)
      }
    }

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current--
      if (dragCounter.current === 0) {
        setIsDragging(false)
      }
    }

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setIsDragging(false)
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        handleFilesRef.current(files)
        return
      }

      const transferredText = e.dataTransfer?.getData('text/plain')
      
      const imageIds = transferredText?.startsWith('agent-images:') 
        ? transferredText.slice('agent-images:'.length).split(',') 
        : transferredText?.startsWith('agent-image:')
        ? [transferredText.slice('agent-image:'.length)]
        : []

      if (imageIds.length > 0) {
        Promise.all(imageIds.map(async (imageId) => {
          const dataUrl = await ensureImageCached(imageId)
          if (!dataUrl) {
            showToast('部分图片已不存在', 'error')
            return
          }
          addInputImage({ id: imageId, dataUrl })
        })).then(() => {
          showToast('已上传图片', 'success')
        }).catch((err) => showToast(`上传图片失败：${err instanceof Error ? err.message : String(err)}`, 'error'))
      }
    }

    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('drop', handleDrop)

    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('drop', handleDrop)
    }
  }, [addInputImage, showToast])

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return

    // 计算图片区域等固定高度
    const imagesHeight = imagesRef.current?.offsetHeight ?? 0
    const fixedOverhead = imagesHeight + 140

    // 展开时填满卡片的剩余空间，普通状态最多占页面的 40%。
    const normalMaxH = Math.max(window.innerHeight * 0.4 - fixedOverhead, 80)
    const maxH = promptExpanded
      ? Math.max(el.parentElement?.clientHeight ?? 0, 80)
      : normalMaxH

    // 1. 清零高度以获取真实文本高度
    el.style.transition = 'none'
    el.style.height = '0'
    el.style.overflowY = 'hidden'
    const scrollH = el.scrollHeight

    const placeholderEl = el.parentElement?.querySelector('.prompt-placeholder')
    const placeholderH = placeholderEl ? placeholderEl.scrollHeight : 0
    const minH = Math.max(42, placeholderH)

    const desired = Math.max(scrollH, minH)
    const targetH = desired > maxH ? maxH : desired

    // 判断是否为单行
    setIsSingleLine(desired <= minH)
    setPromptCanExpand(desired > normalMaxH)

    // 2. 回设旧高度并重绘以准备触发动画
    el.style.height = prevHeightRef.current + 'px'
    void el.offsetHeight

    // 3. 恢复平滑过渡并设置新目标高度
    el.style.transition = 'height 150ms ease, border-color 200ms, box-shadow 200ms'
    el.style.height = targetH + 'px'
    el.style.overflowY = desired > maxH ? 'auto' : 'hidden'

    prevHeightRef.current = targetH
  }, [promptExpanded])

  // 同步 prompt 至 contentEditable
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    // 输入时不重复渲染以防光标跳动
    if (isUserInputRef.current) {
      isUserInputRef.current = false
      return
    }
    const parts = getPromptMentionParts(prompt, inputImages)
    const html = prompt
      ? parts.map((part) =>
          part.type === 'mention'
              ? `<span contenteditable="false" class="mention-tag" data-mention-text="${part.mentionText ?? getSelectedImageMentionLabel(part.imageIndex ?? 0)}">${part.text}</span>`
            : part.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        ).join('')
      : ''
    if (el.innerHTML !== html) {
      el.innerHTML = html
    }
  }, [prompt, inputImages])

  // 补 <br> 哨兵避免 pre-wrap 吃掉行尾 \n，同时不影响纯文本读取。
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const last = el.lastChild
    const hasSentinel = last instanceof HTMLBRElement && last.dataset.sentinelBr === 'true'
    const needSentinel = prompt.endsWith('\n')
    if (needSentinel && !hasSentinel) {
      const br = document.createElement('br')
      br.dataset.sentinelBr = 'true'
      el.appendChild(br)
    } else if (!needSentinel && hasSentinel) {
      last.remove()
    }
  }, [prompt, inputImages])

  useEffect(() => {
    adjustTextareaHeight()
  }, [prompt, inputImages, adjustTextareaHeight, isMobile, mobileCollapsed, promptExpanded])

  // 监听 selectionchange 更新光标位置（onSelect 在 contentEditable 下不可靠）
  useEffect(() => {
    const handleSelectionChange = () => {
      const el = textareaRef.current
      if (!el) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return

      const domRange = sel.getRangeAt(0)
      try {
        if (!domRange.intersectsNode(el)) {
          syncMentionTagSelection(el)
          return
        }
      } catch {
        return
      }

      const range = getContentEditableSelection(el)
      setCursorPos(range.start)
      syncMentionTagSelection(el)

      const rangeRect = domRange.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      if (rangeRect.width === 0 && rangeRect.height === 0) return
      setMenuLeft(rangeRect.left - elRect.left)
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [])

  // 点击外部时使 input 栏失焦
  useEffect(() => {
    const handleGlobalMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return

      if (document.activeElement instanceof HTMLElement) {
        // 若当前聚焦在输入栏内
        if (document.activeElement.closest('[data-input-bar]')) {
          // 若点击在输入栏外部
          if (!target.closest('[data-input-bar]')) {
            document.activeElement.blur()
          }
        }
      }
    }

    document.addEventListener('mousedown', handleGlobalMouseDown, true)
    return () => {
      document.removeEventListener('mousedown', handleGlobalMouseDown, true)
    }
  }, [])
  useEffect(() => {
    adjustTextareaHeight()
  }, [inputImages.length, Boolean(maskDraft), maskPreviewUrl, adjustTextareaHeight])

  useEffect(() => {
    window.addEventListener('resize', adjustTextareaHeight)
    return () => window.removeEventListener('resize', adjustTextareaHeight)
  }, [adjustTextareaHeight])

  // 移动端拖动条手势
  useEffect(() => {
    const el = handleRef.current
    if (!el) return
    const onTouchStart = (e: TouchEvent) => {
      dragTouchRef.current = { startY: e.touches[0].clientY, moved: false }
    }
    const onTouchMove = (e: TouchEvent) => {
      const dy = e.touches[0].clientY - dragTouchRef.current.startY
      if (Math.abs(dy) > 10) dragTouchRef.current.moved = true
      if (dy > 30) setMobileCollapsed(true)
      if (dy < -30) setMobileCollapsed(false)
    }
    const onTouchEnd = () => {
      if (dragTouchRef.current.moved) {
        suppressHandleClickUntilRef.current = Date.now() + 500
      }
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  const selectClass = 'px-2 sm:px-2.5 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] text-xs transition-all duration-200 shadow-sm'

  const getTouchDropIndex = (touch: React.Touch) => {
    const target = document
      .elementFromPoint(touch.clientX, touch.clientY)
      ?.closest<HTMLElement>('[data-input-image-index]')
    if (!target) return null
    const idx = Number(target.dataset.inputImageIndex)
    if (!Number.isInteger(idx)) return null
    const rect = getSafeBoundingClientRect(target)
    if (!rect) return null
    return touch.clientX < rect.left + rect.width / 2 ? idx : idx + 1
  }

  const normalizeImageDropIndex = (idx: number) => {
    const minIdx = maskTargetImage ? 1 : 0
    return Math.max(minIdx, Math.min(inputImages.length, idx))
  }

  const isBeforeMaskDropArea = (clientX: number) => {
    if (!maskTargetImage) return false
    const maskEl = document.querySelector<HTMLElement>('[data-input-image-index="0"]')
    if (!maskEl) return false
    const rect = getSafeBoundingClientRect(maskEl)
    if (!rect) return false
    return clientX < rect.left + rect.width / 2
  }

  const resetImageDrag = () => {
    setImageDragIndex(null)
    setImageDragOverIndex(null)
    imageDragIndexRef.current = null
    imageDragOverIndexRef.current = null
    imageTouchDragRef.current = { index: null, startX: 0, startY: 0, moved: false }
    setTouchDragPreview(null)
    imageDragPreviewRef.current?.remove()
    imageDragPreviewRef.current = null
    hideImageHint()
  }

  useEffect(() => {
    if (!touchDragPreview) return
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [touchDragPreview])

  const getDataTransferDragIndex = (e: React.DragEvent) => {
    const value = e.dataTransfer.getData('text/plain')
    const idx = Number(value)
    return Number.isInteger(idx) ? idx : null
  }

  const setImageDragTarget = (idx: number | null, clientX?: number) => {
    const fromIdx = imageDragIndexRef.current
    if (fromIdx !== null && maskTargetImage && (idx === 0 || (clientX != null && isBeforeMaskDropArea(clientX)))) {
      showImageHint(maskTargetImage.id)
      imageDragOverIndexRef.current = null
      setImageDragOverIndex(null)
      return
    }

    if (fromIdx !== null) hideImageHint()
    const normalizedIdx = idx == null ? null : normalizeImageDropIndex(idx)
    const isNoopTarget = fromIdx !== null && normalizedIdx !== null && (normalizedIdx === fromIdx || normalizedIdx === fromIdx + 1)
    const nextIdx = isNoopTarget ? null : normalizedIdx
    imageDragOverIndexRef.current = nextIdx
    setImageDragOverIndex(nextIdx)
  }

  const renderImageThumb = (img: (typeof inputImages)[number], idx: number) => {
    const isMaskTarget = maskDraft?.targetImageId === img.id
    const isOverLimit = idx >= API_MAX_IMAGES
    const imageHintText = isMaskTarget
      ? '遮罩图必须为第一张图'
      : isOverLimit
      ? getInputImageLimitHint(API_MAX_IMAGES)
      : ''
    const displaySrc = isMaskTarget && maskPreviewUrl ? maskPreviewUrl : img.dataUrl
    const isImageDragging = imageDragIndex === idx
    const isLast = idx === inputImages.length - 1
    const showDropBefore = imageDragOverIndex === idx && imageDragIndex !== idx
    const showDropAfter = imageDragOverIndex === inputImages.length && isLast && imageDragIndex !== idx

    const handleDragStart = (e: React.DragEvent) => {
      if (isMaskTarget) {
        showImageHintUntilRelease(img.id)
        e.preventDefault()
        return
      }
      hideImageHint()
      imageDragIndexRef.current = idx
      setImageDragIndex(idx)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(idx))
      const preview = document.createElement('div')
      preview.style.cssText = 'position:fixed;left:-1000px;top:-1000px;width:52px;height:52px;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.25);'
      const previewImg = document.createElement('img')
      previewImg.src = displaySrc
      previewImg.style.cssText = 'width:52px;height:52px;object-fit:cover;display:block;'
      preview.appendChild(previewImg)
      document.body.appendChild(preview)
      imageDragPreviewRef.current = preview
      e.dataTransfer.setDragImage(preview, 26, 26)
    }

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const fromIdx = imageDragIndexRef.current
      if (fromIdx === null || fromIdx === idx) return
      const rect = getSafeBoundingClientRect(e.currentTarget)
      if (!rect) return
      setImageDragTarget(e.clientX < rect.left + rect.width / 2 ? idx : idx + 1, e.clientX)
    }

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault()
      const fromIdx = imageDragIndexRef.current ?? getDataTransferDragIndex(e)
      const toIdx = imageDragOverIndexRef.current
      if (fromIdx !== null && toIdx !== null) {
        moveInputImage(fromIdx, toIdx)
      }
      resetImageDrag()
    }

    const handleTouchStart = (e: React.TouchEvent) => {
      if (isMaskTarget) {
        const touch = e.touches[0]
        imageTouchDragRef.current = { index: idx, startX: touch.clientX, startY: touch.clientY, moved: false }
        return
      }
      const touch = e.touches[0]
      imageDragIndexRef.current = idx
      imageTouchDragRef.current = { index: idx, startX: touch.clientX, startY: touch.clientY, moved: false }
      setTouchDragPreview(null)
      // 超限图片长按显示原因提示
      if (isOverLimit) {
        clearImageHintTimer()
        imageHintTimerRef.current = window.setTimeout(() => {
          showImageHintUntilRelease(img.id)
        }, 450)
      }
    }

    const handleTouchMove = (e: React.TouchEvent) => {
      const touch = e.touches[0]
      const touchDrag = imageTouchDragRef.current
      if (touchDrag.index === null) return

      if (isMaskTarget) {
        if (Math.abs(touch.clientX - touchDrag.startX) > 6 || Math.abs(touch.clientY - touchDrag.startY) > 6) {
          e.preventDefault()
          showImageHintUntilRelease(img.id)
        }
        return
      }

      // 纵向手势让位给参考图区滚动，只有横向拖动才进入排序
      if (!touchDrag.moved) {
        const dx = Math.abs(touch.clientX - touchDrag.startX)
        const dy = Math.abs(touch.clientY - touchDrag.startY)
        if (dy >= dx) {
          imageTouchDragRef.current = { index: null, startX: 0, startY: 0, moved: false }
          return
        }
        touchDrag.moved = true
      }
      clearImageHintTimer()
      setImageHintId(null)
      suppressImageClickRef.current = true
      e.preventDefault()
      setImageDragIndex(touchDrag.index)
      setTouchDragPreview({ src: displaySrc, x: touch.clientX, y: touch.clientY })
      const dropIndex = getTouchDropIndex(touch)
      setImageDragTarget(dropIndex, touch.clientX)
    }

    const handleTouchEnd = (e: React.TouchEvent) => {
      const touchDrag = imageTouchDragRef.current
      clearImageHintTimer()
      if (touchDrag.index !== null && imageDragOverIndexRef.current !== null) {
        e.preventDefault()
        moveInputImage(touchDrag.index, imageDragOverIndexRef.current)
        window.setTimeout(() => {
          suppressImageClickRef.current = false
        }, 0)
      }
      resetImageDrag()
      hideLockedImageHint()
    }

    const handleTouchCancel = () => {
      suppressImageClickRef.current = false
      hideLockedImageHint()
      resetImageDrag()
    }

    return (
      <div
        key={img.id}
        data-input-image-index={idx}
        className={`relative group inline-block h-[52px] w-[52px] shrink-0 self-start transition-opacity ${isImageDragging ? 'opacity-40' : ''} ${isOverLimit ? 'grayscale opacity-40' : ''}`}
        style={{ touchAction: 'pan-y' }}
        draggable={!isMobile}
        onMouseEnter={() => {
          if (imageHintText) showImageHint(img.id)
        }}
        onMouseLeave={hideImageHint}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={resetImageDrag}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onContextMenu={(e) => {
          e.preventDefault()
          const el = textareaRef.current
          const cursor = el ? getContentEditableCursor(el) : prompt.length
          if (el) {
            el.focus()
            setContentEditableCursor(el, cursor)
            if (document.execCommand('insertHTML', false, getMentionTagHtml(getImageMentionLabel(idx)))) {
              syncPromptFromContentEditable()
              return
            }
          }
          const next = insertImageMentionAtVisibleRange(prompt, cursor, cursor, idx)
          isUserInputRef.current = false
          setPrompt(next.prompt)
          window.setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.focus()
              setContentEditableCursor(textareaRef.current, next.cursor)
            }
          }, 0)
        }}
      >
        <ButtonTooltip
          visible={imageHintId === img.id && Boolean(imageHintText) && (!isMobile || isMaskTarget || isOverLimit)}
          text={imageHintText}
        />
        {showDropBefore && (
          <div className="absolute -left-[5px] top-0 bottom-0 w-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
        )}
        {showDropAfter && (
          <div className="absolute -right-[5px] top-0 bottom-0 w-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
        )}
        <div
          className={`relative w-[52px] h-[52px] rounded-xl overflow-hidden shadow-sm cursor-grab active:cursor-grabbing select-none ${
            isMaskTarget
              ? 'border-2 border-blue-500'
              : 'border border-gray-200 dark:border-white/[0.08]'
          }`}
          onClick={() => {
            if (suppressImageClickRef.current) return
            setLightboxImageId(img.id, inputImages.map((i) => i.id))
          }}
        >
          {displaySrc && (
            <div className="h-full w-full overflow-hidden">
              <img
                src={displaySrc}
                className="w-full h-full object-cover hover:opacity-90 transition-opacity pointer-events-none"
                alt=""
              />
            </div>
          )}
          {isMaskTarget && (
            <span className="absolute left-1 top-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[8px] leading-none text-white font-bold tracking-wider backdrop-blur-sm z-10 pointer-events-none">
              MASK
            </span>
          )}
          <span className="absolute bottom-1 left-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-[9px] font-semibold text-white backdrop-blur-sm z-10 pointer-events-none">
            {idx + 1}
          </span>
          <button
            className="absolute inset-0 w-full h-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer z-20 focus:outline-none border-none"
            onClick={(e) => {
              e.stopPropagation()
              setLightboxImageId(img.id, inputImages.map((i) => i.id))
            }}
            title="查看"
            aria-label="查看参考图"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 12s3.5-6 9.75-6 9.75 6 9.75 6-3.5 6-9.75 6S2.25 12 2.25 12z" />
              <circle cx="12" cy="12" r="2.75" strokeWidth={2} />
            </svg>
          </button>
        </div>
        {!isMaskTarget && (
          <span
            className="absolute right-0 top-0 flex h-5 w-5 translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-opacity hover:bg-red-600 group-hover:opacity-100 z-30"
            onClick={(e) => {
              e.stopPropagation()
              removeInputImage(idx)
            }}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </span>
        )}
      </div>
    )
  }

  const renderClearAllButton = () => (
    <button
      onClick={() =>
        setConfirmDialog({
          title: maskTargetImage ? '清空全部输入图' : '清空参考图',
          message: maskTargetImage
            ? `确定要清空遮罩主图、${referenceImages.length} 张参考图和当前遮罩吗？`
            : `确定要清空全部 ${inputImages.length} 张参考图吗？`,
          action: () => clearInputImages(),
        })
      }
      className="w-[52px] h-[52px] rounded-xl border border-dashed border-gray-300 dark:border-white/[0.08] flex flex-col items-center justify-center gap-0.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:border-red-300 hover:bg-red-50/50 dark:hover:bg-red-950/30 transition-all cursor-pointer flex-shrink-0"
      title={maskTargetImage ? '清空遮罩主图、参考图和遮罩' : '清空全部参考图'}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
      <span className="text-[8px] leading-none">{maskTargetImage ? '清空全部' : '清空'}</span>
    </button>
  )

  const renderImageThumbs = () => {
    return (
      <div ref={imagesRef}>
        <div
          className="mb-3 max-h-[min(140px,25dvh)] sm:max-h-[min(204px,30dvh)] overflow-y-auto overflow-x-hidden overscroll-y-contain"
          role="region"
          aria-label="参考图"
          onScroll={hideImageHint}
        >
          <div className="grid grid-cols-[repeat(auto-fill,52px)] justify-between gap-x-2 gap-y-3">
            {inputImages.map((img, idx) => renderImageThumb(img, idx))}
            {renderClearAllButton()}
          </div>
        </div>
        {touchDragPreview?.src && createPortal(
          <div
            className="fixed z-[140] h-[52px] w-[52px] overflow-hidden rounded-xl shadow-xl pointer-events-none opacity-90"
            style={{ left: touchDragPreview.x, top: touchDragPreview.y, transform: 'translate(-50%, -50%)' }}
          >
            <img src={touchDragPreview.src} className="h-full w-full object-cover" alt="" />
          </div>,
          document.body,
        )}
      </div>
    )
  }

  const renderParams = (cols: string) => (
    <InputParamsPanel
      cols={cols}
      params={params}
      setParams={setParams}
      activeProfile={activeProfile}
      isFalProvider={isFalProvider}
      isFalTextToImage={isFalTextToImage}
      displaySize={displaySize}
      qualityOptions={qualityOptions}
      selectClass={selectClass}
      transparentOutputAvailable={transparentOutputAvailable}
      showTransparentOutputControl={showTransparentOutputControl}
      transparentOutputEnabled={transparentOutputEnabled}
      transparentOutputHint={transparentOutputHint}
      onTransparentOutputMenuOpenChange={handleTransparentOutputMenuOpenChange}
      compressionHint={compressionHint}
      compressionDisabled={compressionDisabled}
      outputCompressionInput={outputCompressionInput}
      setOutputCompressionInput={setOutputCompressionInput}
      commitOutputCompression={commitOutputCompression}
      moderationHint={moderationHint}
      moderationDisabled={moderationDisabled}
      agentAutoImageCount={agentAutoImageCount}
      outputImageLimit={outputImageLimit}
      nInput={nInput}
      setNInputFocused={setNInputFocused}
      commitN={commitN}
      handleNInputChange={handleNInputChange}
      handleNLimitIncreaseAttempt={handleNLimitIncreaseAttempt}
      showAgentNHint={showAgentNHint}
      hideNLimitHint={hideNLimitHint}
      startAgentNHintTouch={startAgentNHintTouch}
      clearAgentNHintTouchTimer={clearAgentNHintTouchTimer}
      nLimitHint={nLimitHint}
      nLimitHintText={nLimitHintText}
      streamConcurrentByN={streamConcurrentByN}
      streamConcurrentHint={streamConcurrentHint}
      sizeHint={sizeHint}
      qualityHint={qualityHint}
      onOpenSizePicker={() => setShowSizePicker(true)}
      currentModel={activeProfile.model}
      availableModels={availableModels}
      isLoadingImageModels={imageCatalog.status === 'loading'}
      imageModelError={imageCatalog.status === 'error'}
      onModelChange={handleModelChange}
      isAgentMode={appMode === 'agent'}
      agentTextProfiles={agentTextProfiles}
      currentAgentTextProfileId={currentAgentTextProfileId}
      onAgentTextProfileChange={(id) => setSettings({ agentTextProfileId: id })}
      agentImageProfiles={agentImageProfiles}
      poolProfileAvailable={poolProfileAvailable}
      currentAgentImageProfileId={
        appMode === 'agent'
          ? (settings.agentImageProfileId || POOL_PROFILE_ID)
          : activeProfile.id
      }
      onAgentImageProfileChange={(id) => {
        if (appMode === 'agent') {
          setSettings({ agentImageProfileId: id })
        } else {
          // Gallery mode: switch the active profile
          setSettings({ activeProfileId: id })
        }
      }}
    />
  )

  const showFavoriteCollectionBatchBar = inCollectionOverview && selectedFavoriteCollectionIds.length > 0
  const showTaskBatchBar = !showFavoriteCollectionBatchBar && selectedTaskIds.length > 0

  return (
    <>
      <DragUploadOverlay visible={isDragging} atImageLimit={atImageLimit} maxImages={API_MAX_IMAGES} />

      {showSizePicker && (
        <SizePickerModal
          currentSize={isFalTextToImage && params.size === 'auto' ? DEFAULT_FAL_IMAGE_SIZE : params.size}
          onSelect={(size) => setParams({ size })}
          onClose={() => setShowSizePicker(false)}
          allowAuto={!isFalTextToImage}
          codexCli={activeProfile.codexCli}
          codexPoolImage={isPoolProfile && isGptImage25Model(getImageGenerationModel(activeProfile))}
        />
      )}

      <div
        data-input-bar
        className={`${isAgentMode
          ? 'studio-agent-input-bar relative z-20 w-full shrink-0'
          : 'fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-5xl px-3 sm:px-4'
        } transition-all duration-300${promptExpanded ? ' flex flex-col' : ''}`}
        style={!isAgentMode && promptExpanded ? { top: `${promptExpandedTop}px`, transitionProperty: 'none' } : undefined}
      >
        <InputBatchBars
          showFavoriteCollectionBatchBar={showFavoriteCollectionBatchBar}
          showTaskBatchBar={showTaskBatchBar}
          selectedTaskIds={selectedTaskIds}
          tasks={tasks}
          clearFavoriteCollectionSelection={clearFavoriteCollectionSelection}
          onSelectAllVisibleFavoriteCollections={handleSelectAllVisibleFavoriteCollections}
          onInvertVisibleFavoriteCollections={handleInvertVisibleFavoriteCollections}
          onDownloadSelectedFavoriteCollections={handleDownloadSelectedFavoriteCollections}
          onDeleteSelectedFavoriteCollections={handleDeleteSelectedFavoriteCollections}
          clearSelection={clearSelection}
          onSelectAllVisibleTasks={handleSelectAllVisibleTasks}
          onInvertVisibleTasks={handleInvertVisibleTasks}
          onToggleFavorite={handleToggleFavorite}
          onDownloadSelected={handleDownloadSelected}
          onDeleteSelected={handleDeleteSelected}
        />
        {appMode === 'agent' && isPoolBuild && !promptExpanded && (
          <div className="studio-conversation-actions" data-no-drag-select>
            <button ref={historyButtonRef} type="button" aria-expanded={historyOpen} aria-haspopup="dialog" onClick={() => setHistoryOpen(!historyOpen)}>
              <HistoryIcon aria-hidden="true" />对话历史
            </button>
            <button type="button" onClick={() => { closeHistory(); createConversation() }}>
              <PlusIcon aria-hidden="true" />新建对话
            </button>
            {historyOpen && <HistoryModal placement="above" onClose={closeHistory} ignoreOutsideClickRef={historyButtonRef} />}
          </div>
        )}
        <div ref={cardRef} className={`studio-input-card p-3${promptExpanded ? ' flex min-h-0 flex-1 flex-col' : ''}`}>
          {/* 移动端拖动条 */}
          <button
            ref={handleRef}
            type="button"
            aria-expanded={!mobileCollapsed}
            aria-controls="studio-mobile-params"
            className={promptExpanded ? 'hidden' : 'studio-mobile-params-toggle sm:hidden'}
            onClick={() => {
              if (Date.now() < suppressHandleClickUntilRef.current) {
                suppressHandleClickUntilRef.current = 0
                return
              }
              setMobileCollapsed((v) => !v)
            }}
          >
            {mobileCollapsed ? '展开参数' : '收起参数'}
            <span aria-hidden="true">{mobileCollapsed ? '＋' : '−'}</span>
          </button>

          {/* 输入图片行（移动端可折叠） */}
          {inputImages.length > 0 && (
            isMobile ? (
              <>
                <div className={`collapse-section${mobileCollapsed ? ' collapsed' : ''}`}>
                  <div className="collapse-inner">
                    {renderImageThumbs()}
                  </div>
                </div>
                {mobileCollapsed && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 mb-2 ml-1">
                    {maskDraft ? `1 张遮罩主图 · ${referenceImages.length} 张参考图` : `${inputImages.length} 张参考图`}
                  </div>
                )}
              </>
            ) : (
              renderImageThumbs()
            )
          )}

          {/* 输入框 */}
          <div className={`relative grid${promptExpanded ? ' min-h-0 flex-1' : ''}`}>
            {showAtImageMenu && (
              <div style={{ left: `${menuLeft}px` }} className="absolute bottom-full z-50 mb-2 w-64 overflow-hidden rounded-2xl border border-gray-200/70 bg-white/95 p-1.5 shadow-xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
                <div className="px-2 pb-1 pt-0.5 text-[11px] text-gray-400 dark:text-gray-500">选择图片引用</div>
                <div className="max-h-56 overflow-y-auto custom-scrollbar">
                  {atImageOptions.map((option, optionIndex) => (
                    <button
                      key={option.key}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        selectAtImageOption(option)
                      }}
                      onMouseEnter={() => setAtImageMenuIndex(optionIndex)}
                      className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs transition-colors ${
                        optionIndex === atImageMenuIndex
                          ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
                          : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                        }`}
                    >
                      <AtImageOptionThumb option={option} />
                      <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                      {option.type === 'agent-output' && <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">历史</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div
              ref={textareaRef}
              contentEditable
              suppressContentEditableWarning
              onInput={(e) => {
                isUserInputRef.current = true
                const el = e.currentTarget
                const range = getContentEditableSelection(el)
                setCursorPos(range.start)
                syncMentionTagSelection(el)
                const text = getContentEditablePlainText(el)
                setPrompt(text)
                setAtImageMenuIndex(0)
                setAtImageMenuDismissed(false)
              }}
              onSelect={(e) => {
                const el = e.currentTarget
                const range = getContentEditableSelection(el)
                setCursorPos(range.start)
                syncMentionTagSelection(el)
                setAtImageMenuIndex(0)
                setAtImageMenuDismissed(false)
              }}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => {
                isComposingRef.current = true
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false
              }}
              onPaste={handlePromptPaste}
              onCopy={handlePromptCopy}
              onClick={(e) => {
                const el = textareaRef.current
                if (!el) return
                const target = e.target as HTMLElement
                if (target.classList.contains('mention-tag')) {
                  const sel = window.getSelection()
                  if (sel) {
                    const range = document.createRange()
                    range.selectNode(target)
                    sel.removeAllRanges()
                    sel.addRange(range)
                    syncMentionTagSelection(el)
                  }
                  return
                }

                syncMentionTagSelection(el)
              }}
              aria-label={promptPlaceholder}
              role="textbox"
              aria-multiline="true"
              className={`studio-prompt col-start-1 row-start-1 w-full overflow-hidden ios-rounded-scroll-fix whitespace-pre-wrap break-words pl-4 pr-10 py-3 leading-relaxed${promptExpanded ? ' !h-full !overflow-y-auto' : ''}`}
            />
            {prompt.length === 0 && (
              <div aria-hidden="true" className={`studio-prompt-placeholder prompt-placeholder relative col-start-1 row-start-1 pointer-events-none pl-4 pr-10 py-3 leading-relaxed${
                isMobile && mobileCollapsed ? ' truncate' : ''
              }`}>
                {promptPlaceholder}
              </div>
            )}
            {prompt.length > 0 && (
              <div
                className={`absolute z-10 ${
                  isSingleLine ? 'right-3 top-1/2 -translate-y-1/2' : 'right-3 top-3'
                }`}
                onMouseEnter={() => setClearPromptHover(true)}
                onMouseLeave={() => setClearPromptHover(false)}
              >
                <ButtonTooltip visible={clearPromptHover} text="清空文本" />
                <button
                  type="button"
                  onClick={() => {
                    setClearPromptHover(false)
                    handleClearPrompt()
                  }}
                  className="flex items-center justify-center rounded-full p-1 text-gray-400 transition-all duration-200 hover:bg-gray-100 hover:text-gray-600 focus:outline-none dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
                  aria-label="清空文本"
                >
                  <CloseIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {showPromptExpand && (
              <div
                className="absolute bottom-2.5 right-2.5 z-10"
                onMouseEnter={() => setExpandPromptHover(true)}
                onMouseLeave={() => setExpandPromptHover(false)}
              >
                <ButtonTooltip visible={expandPromptHover} text={promptExpanded ? '恢复输入框' : '展开输入框'} />
                <button
                  type="button"
                  onClick={() => {
                    setExpandPromptHover(false)
                    setPromptExpanded((expanded) => !expanded)
                    setMobileCollapsed(false)
                  }}
                  className="flex items-center justify-center rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
                  aria-label={promptExpanded ? '恢复输入框' : '展开输入框'}
                  aria-pressed={promptExpanded}
                >
                  {promptExpanded ? <CollapseIcon className="h-4 w-4" /> : <ExpandIcon className="h-4 w-4" />}
                </button>
              </div>
            )}
          </div>

          {/* 参数 + 按钮 */}
          <div className="mt-3">
            {/* 桌面端布局 */}
            <div className="studio-composer-controls hidden sm:flex items-end justify-between gap-3">
              {renderParams(
                appMode === 'agent'
                  ? (showImageModelControl
                      ? 'grid-cols-[minmax(145px,1.8fr)_minmax(160px,2fr)_minmax(68px,0.85fr)_repeat(4,minmax(54px,0.7fr))_minmax(44px,0.55fr)]'
                      : 'grid-cols-[minmax(165px,2fr)_minmax(72px,0.9fr)_repeat(4,minmax(56px,0.75fr))_minmax(44px,0.55fr)]')
                  : (showImageModelControl
                      ? 'grid-cols-[minmax(185px,2.4fr)_minmax(72px,0.95fr)_repeat(4,minmax(60px,0.75fr))_minmax(44px,0.55fr)]'
                      : 'grid-cols-[repeat(5,minmax(64px,1fr))_minmax(44px,0.6fr)]')
              )}

              <div className="flex items-center gap-2 flex-shrink-0 mb-0.5">
                {isSharedProfile ? (
                  <div
                    className="flex items-center self-center px-2.5 py-1.5 rounded-xl border border-emerald-200/60 bg-emerald-50/70 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300 text-xs font-medium shadow-sm whitespace-nowrap select-none"
                    title={`共享渠道（${activeProfile.name || selectedModel}），全站共享可用`}
                  >
                    <span className="inline-block size-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                    <span>共享可用</span>
                  </div>
                ) : currentModelQuota !== null ? (
                  <div
                    className="flex items-center self-center px-2.5 py-1.5 rounded-xl border border-blue-200/60 bg-blue-50/70 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 text-xs font-medium shadow-sm whitespace-nowrap select-none"
                    title={`当前模型（${selectedModel}）可用额度：${currentModelQuota.toLocaleString()}（号池总额度：${quotaData?.totalQuota.toLocaleString() || 0}）`}
                  >
                    {currentModelQuota === 0 ? '当前模型暂无额度' : `剩余额度 ${currentModelQuota.toLocaleString()}`}
                  </div>
                ) : null}
                <div
                  className="relative"
                  onMouseEnter={() => setAttachHover(true)}
                  onMouseLeave={() => setAttachHover(false)}
                >
                  <ButtonTooltip visible={attachHover} text={uploadImageTooltipText} />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="studio-attachment-button transition-colors"
                    aria-label={uploadImageTooltipText}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  </button>
                </div>
                <div
                  className="relative"
                  onMouseEnter={() => setSubmitHover(true)}
                  onMouseLeave={() => setSubmitHover(false)}
                >
                  <ButtonTooltip visible={(activeAgentIsRunning || !hasSubmitApiConfig) && submitHover} text={submitTooltipText} />
                  <button
                    onClick={() => activeAgentIsRunning ? stopActiveAgentResponse() : hasSubmitApiConfig ? submitCurrentMode() : setShowSettings(true)}
                    disabled={activeAgentIsRunning ? false : hasSubmitApiConfig ? !canSubmit : false}
                    className={`studio-submit inline-flex items-center justify-center gap-1.5 px-3 transition-colors ${
                      activeAgentIsRunning
                        ? 'bg-red-500 text-white hover:bg-red-600'
                        : !hasSubmitApiConfig
                        ? 'studio-submit-config'
                        : 'studio-submit-primary'
                    }`}
                    aria-label={submitButtonAriaLabel}
                  >
                    <span className="hidden md:inline whitespace-nowrap">{submitButtonAriaLabel}</span>
                    {activeAgentIsRunning ? (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="7" y="7" width="10" height="10" rx="1.5" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* 移动端布局 */}
            <div className="sm:hidden flex flex-col gap-2">
              <div id="studio-mobile-params" inert={mobileCollapsed} className={`collapse-section${mobileCollapsed ? ' collapsed' : ''}`}>
                <div className="collapse-inner">
                  {renderParams('grid-cols-2')}
                  <div className="h-2" />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                {isSharedProfile ? (
                  <div
                    className="flex items-center px-2.5 py-1 rounded-lg bg-emerald-50/80 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-medium whitespace-nowrap select-none"
                    title={`共享渠道（${activeProfile.name || selectedModel}），全站共享可用`}
                  >
                    <span className="inline-block size-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                    <span>共享可用</span>
                  </div>
                ) : currentModelQuota !== null ? (
                  <div
                    className="flex items-center px-2.5 py-1 rounded-lg bg-blue-50/80 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 text-xs font-medium"
                    title={`当前模型（${selectedModel}）可用额度：${currentModelQuota.toLocaleString()}（号池总额度：${quotaData?.totalQuota.toLocaleString() || 0}）`}
                  >
                    {currentModelQuota === 0 ? '暂无额度' : `剩余额度 ${currentModelQuota.toLocaleString()}`}
                  </div>
                ) : null}
                <div className="flex items-center gap-2 ml-auto">
                  <div
                    className="relative"
                    onMouseEnter={() => setAttachHover(true)}
                    onMouseLeave={() => setAttachHover(false)}
                  >
                    <button
                      onClick={() => setShowMobileUploadMenu(!showMobileUploadMenu)}
                      className="studio-attachment-button transition-colors"
                      aria-label={uploadImageTooltipText}
                    >
                      <svg
                        className={`w-5 h-5 transition-transform duration-200 ${showMobileUploadMenu ? 'rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>

                    {/* Mobile Upload Menu */}
                    {showMobileUploadMenu && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setShowMobileUploadMenu(false)}
                        />
                        <div className="absolute bottom-full left-0 mb-2 w-32 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
                          <button
                            className="w-full px-4 py-3 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
                            onClick={() => {
                              setShowMobileUploadMenu(false)
                              cameraInputRef.current?.click()
                            }}
                          >
                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            拍照上传
                          </button>
                          <button
                            className="w-full px-4 py-3 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 border-t border-gray-100 dark:border-gray-700/50 transition-colors"
                            onClick={() => {
                              setShowMobileUploadMenu(false)
                              fileInputRef.current?.click()
                            }}
                          >
                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            相册选择
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => activeAgentIsRunning ? stopActiveAgentResponse() : hasSubmitApiConfig ? submitCurrentMode() : setShowSettings(true)}
                    disabled={activeAgentIsRunning ? false : hasSubmitApiConfig ? !canSubmit : false}
                    className={`studio-submit flex-1 flex items-center justify-center gap-2 px-3 text-sm font-medium transition-colors ${
                      activeAgentIsRunning
                        ? 'bg-red-500 text-white hover:bg-red-600'
                        : !hasSubmitApiConfig
                        ? 'studio-submit-config'
                        : 'studio-submit-primary'
                    }`}
                  >
                    {activeAgentIsRunning ? (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="7" y="7" width="10" height="10" rx="1.5" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    )}
                    {submitButtonAriaLabel}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>
      </div>
    </>
  )
}
