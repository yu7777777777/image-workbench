import { useEffect, useRef, type ReactNode } from 'react'
import { clearFailedTasks, useStore, taskMatchesFilterStatus, taskMatchesSearchQuery } from '../store'
import { ALL_FAVORITES_COLLECTION_ID, getTaskFavoriteCollectionIds } from '../lib/favoriteState'
import { GALLERY_DENSITY_OPTIONS, type GalleryDensity } from '../lib/galleryDensity'
import { useTooltip } from '../hooks/useTooltip'
import Select from './Select'
import { ChevronLeftIcon, CollectionManageIcon, FavoriteIcon, TrashIcon } from './icons'
import ViewportTooltip from './ViewportTooltip'
import { useFavoriteCollectionTitle } from './favorites/useFavoriteCollectionTitle'

function SearchActionButton({
  tooltip,
  className,
  disabled = false,
  pressed,
  onClick,
  children,
}: {
  tooltip: string
  className: string
  disabled?: boolean
  pressed?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const tooltipState = useTooltip()

  return (
    <span className="relative inline-flex" {...tooltipState.handlers}>
      <button
        type="button"
        onClick={() => {
          tooltipState.dismiss()
          if (disabled) return
          onClick()
        }}
        disabled={disabled}
        className={className}
        aria-label={tooltip}
        aria-pressed={pressed}
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipState.visible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

function DensityGridIcon({ density }: { density: GalleryDensity }) {
  if (density === 'compact') {
    return (
      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <rect x="1.5" y="1.5" width="3.4" height="3.4" rx="0.8" />
        <rect x="6.3" y="1.5" width="3.4" height="3.4" rx="0.8" />
        <rect x="11.1" y="1.5" width="3.4" height="3.4" rx="0.8" />
        <rect x="1.5" y="6.3" width="3.4" height="3.4" rx="0.8" />
        <rect x="6.3" y="6.3" width="3.4" height="3.4" rx="0.8" />
        <rect x="11.1" y="6.3" width="3.4" height="3.4" rx="0.8" />
        <rect x="1.5" y="11.1" width="3.4" height="3.4" rx="0.8" />
        <rect x="6.3" y="11.1" width="3.4" height="3.4" rx="0.8" />
        <rect x="11.1" y="11.1" width="3.4" height="3.4" rx="0.8" />
      </svg>
    )
  }
  if (density === 'standard') {
    return (
      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <rect x="1.75" y="1.75" width="5.5" height="5.5" rx="1.2" />
        <rect x="8.75" y="1.75" width="5.5" height="5.5" rx="1.2" />
        <rect x="1.75" y="8.75" width="5.5" height="5.5" rx="1.2" />
        <rect x="8.75" y="8.75" width="5.5" height="5.5" rx="1.2" />
      </svg>
    )
  }
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="2.2" />
    </svg>
  )
}

export default function SearchBar() {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const clearSelection = useStore((s) => s.clearSelection)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const galleryDensity = useStore((s) => s.galleryDensity)
  const setGalleryDensity = useStore((s) => s.setGalleryDensity)
  const gallerySelectionMode = useStore((s) => s.gallerySelectionMode)
  const setGallerySelectionMode = useStore((s) => s.setGallerySelectionMode)
  const selectedTaskCount = useStore((s) => s.selectedTaskIds.length)
  const isSelectionActive = gallerySelectionMode || selectedTaskCount > 0
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const setActiveFavoriteCollectionId = useStore((s) => s.setActiveFavoriteCollectionId)
  const openManageCollectionsModal = useStore((s) => s.openManageCollectionsModal)
  const totalCount = useStore((s) => s.tasks.length)
  const visibleCount = useStore((s) => {
    const q = s.searchQuery.trim().toLowerCase()
    return s.tasks.filter((task) => {
      if (s.filterFavorite) {
        if (!task.isFavorite) return false
        if (s.activeFavoriteCollectionId && s.activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID && !getTaskFavoriteCollectionIds(task, s.defaultFavoriteCollectionId).includes(s.activeFavoriteCollectionId)) return false
      }
      if (!taskMatchesFilterStatus(task, s.filterStatus)) return false
      return taskMatchesSearchQuery(task, q)
    }).length
  })
  const isFiltered = Boolean(searchQuery.trim() || filterStatus !== 'all' || filterFavorite)
  const failedCount = useStore((s) => {
    const q = s.searchQuery.trim().toLowerCase()
    return s.tasks.filter((task) => {
      if (!taskMatchesFilterStatus(task, 'error')) return false
      if (s.filterFavorite) {
        if (!task.isFavorite) return false
        if (s.activeFavoriteCollectionId && s.activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID && !getTaskFavoriteCollectionIds(task, s.defaultFavoriteCollectionId).includes(s.activeFavoriteCollectionId)) return false
      }
      return taskMatchesSearchQuery(task, q)
    }).length
  })
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const inCollectionOverview = filterFavorite && !activeFavoriteCollectionId
  const collectionTitle = useFavoriteCollectionTitle()
  const isFailedFilter = filterStatus === 'error'
  const favoriteTooltip = activeFavoriteCollectionId ? '返回收藏夹' : filterFavorite ? '退出收藏夹' : '收藏夹'

  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (document.activeElement !== inputRef.current) return

      const target = event.target instanceof Element ? event.target : document.elementFromPoint(event.clientX, event.clientY)
      if (!target) return
      if (rootRef.current?.contains(target)) return
      if (!target.closest('[data-drag-select-surface]')) return
      if (target.closest('.task-card-wrapper, .favorite-collection-card-wrapper')) return

      inputRef.current?.blur()
    }

    document.addEventListener('mousedown', handleDocumentMouseDown, true)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown, true)
  }, [])

  useEffect(() => {
    if (!isSelectionActive) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const state = useStore.getState()
      if (state.confirmDialog || state.detailTaskId || state.lightboxImageId) return
      clearSelection()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSelectionActive, clearSelection])

  const handleFavoriteClick = () => {
    if (activeFavoriteCollectionId) {
      setActiveFavoriteCollectionId(null)
      return
    }
    setFilterFavorite(!filterFavorite)
  }

  const handleClearFailed = () => {
    const state = useStore.getState()
    const q = state.searchQuery.trim().toLowerCase()
    const failedTaskIds = state.tasks
      .filter((task) => {
        if (!taskMatchesFilterStatus(task, 'error')) return false
        if (state.filterFavorite) {
          if (!task.isFavorite) return false
          if (state.activeFavoriteCollectionId && state.activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID && !getTaskFavoriteCollectionIds(task, state.defaultFavoriteCollectionId).includes(state.activeFavoriteCollectionId)) return false
        }
        return taskMatchesSearchQuery(task, q)
      })
      .map((task) => task.id)
    const failedTaskCount = failedTaskIds.length
    if (failedTaskCount === 0) return

    setConfirmDialog({
      title: '清除失败记录',
      message: `确定清除筛选范围内的失败记录吗？\n纯失败任务会被删除；部分失败任务只会清除失败标记，保留已成功图片。共 ${failedTaskCount} 条记录。`,
      confirmText: '清除',
      cancelText: '取消',
      tone: 'danger',
      action: () => clearFailedTasks(failedTaskIds),
    })
  }

  const handleStatusChange = (val: string | number) => {
    if (val === filterStatus || (val !== 'all' && val !== 'done' && val !== 'running' && val !== 'error')) return
    setFilterStatus(val)
    clearSelection()
  }

  return (
    <div ref={rootRef} data-no-drag-select className="studio-gallery-tools">
      <h1 className={filterFavorite ? 'studio-gallery-title truncate' : 'sr-only'}>{activeFavoriteCollectionId ? collectionTitle : inCollectionOverview ? '收藏夹' : '作品画廊'}</h1>
      <div className="studio-search-bar">
      <div className="relative z-10 min-w-0 flex-1">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={inputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          type="text"
          aria-label={inCollectionOverview ? '搜索收藏夹' : '搜索作品'}
          placeholder={inCollectionOverview ? '搜索收藏夹' : '搜索作品'}
          className="w-full pl-9 pr-3 py-1.5 rounded-lg border text-sm"
        />
      </div>
      <div className="flex gap-1.5 sm:gap-2 shrink-0 z-20">
        <SearchActionButton
          tooltip={favoriteTooltip}
          onClick={handleFavoriteClick}
          pressed={activeFavoriteCollectionId ? undefined : filterFavorite}
          className="studio-filter-control p-2 rounded-lg border transition-colors"
        >
          {activeFavoriteCollectionId ? <ChevronLeftIcon className="w-5 h-5" /> : <FavoriteIcon filled={filterFavorite} className="w-5 h-5" />}
        </SearchActionButton>
        {inCollectionOverview && (
          <SearchActionButton
            tooltip="管理收藏夹"
            onClick={openManageCollectionsModal}
            className="studio-filter-control p-2 rounded-lg border transition-colors"
          >
            <CollectionManageIcon className="w-5 h-5" />
          </SearchActionButton>
        )}
        {!inCollectionOverview && (
          <>
            <div className="relative w-[88px]">
              <Select
                value={filterStatus}
                onChange={handleStatusChange}
                options={[
                  { label: '全部', value: 'all' },
                  { label: '已完成', value: 'done' },
                  { label: '生成中', value: 'running' },
                  { label: '失败', value: 'error' },
                ]}
                className="studio-filter-control px-2.5 py-2 rounded-lg border text-sm transition-colors"
              />
            </div>
            {isFailedFilter && (
              <button
                type="button"
                onClick={handleClearFailed}
                disabled={failedCount === 0}
                title={failedCount > 0 ? `清除 ${failedCount} 条失败记录` : '没有失败记录'}
                aria-label={failedCount > 0 ? `清除 ${failedCount} 条失败记录` : '没有失败记录'}
                className="studio-filter-control flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border transition-colors disabled:cursor-not-allowed disabled:opacity-55"
              >
                <TrashIcon className="h-[18px] w-[18px]" />
              </button>
            )}
          </>
        )}
      </div>
      </div>
      {!inCollectionOverview && (
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {totalCount > 0 && (
            <span className="hidden md:inline-block text-xs text-gray-400 dark:text-gray-500 tabular-nums select-none">
              {isFiltered ? `已筛选 ${visibleCount} / ${totalCount} 张` : `共 ${totalCount} 张作品`}
            </span>
          )}
          {visibleCount > 0 && (
            <button
              type="button"
              onClick={() => {
                if (isSelectionActive) {
                  clearSelection()
                } else {
                  setGallerySelectionMode(true)
                }
              }}
              aria-pressed={isSelectionActive}
              className={`inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                isSelectionActive
                  ? 'border-[#315b73] bg-[#315b73] text-white hover:bg-[#284c61]'
                  : 'studio-filter-control text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {isSelectionActive ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>退出选择{selectedTaskCount > 0 ? ` (${selectedTaskCount})` : ''}</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="4" y="4" width="16" height="16" rx="3" strokeWidth={1.8} />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.5 12.2l2.3 2.3 4.7-4.8" />
                  </svg>
                  <span>批量删除</span>
                </>
              )}
            </button>
          )}
          <div
            role="group"
            aria-label="画廊密度"
            className="studio-density-switch inline-flex items-center p-0.5 rounded-lg border"
          >
            {GALLERY_DENSITY_OPTIONS.map((option) => {
              const active = galleryDensity === option.id
              return (
                <SearchActionButton
                  key={option.id}
                  tooltip={option.description}
                  pressed={active}
                  onClick={() => setGalleryDensity(option.id)}
                  className={`studio-density-btn inline-flex items-center justify-center h-7 w-7 rounded-md transition-colors ${
                    active ? 'studio-density-btn-active' : ''
                  }`}
                >
                  <DensityGridIcon density={option.id} />
                </SearchActionButton>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
