import { useEffect, useState, useRef, type ReactNode } from 'react'
import type { TaskRecord } from '../types'
import { useStore, retryTask } from '../store'
import { ensureImageThumbnailCached, subscribeImageThumbnail } from '../lib/imageCache'
import { formatImageRatio } from '../lib/size'
import ViewportTooltip from './ViewportTooltip'

interface Props {
  task: TaskRecord
  onReuse: () => void
  onEditOutputs: () => void
  onDelete: () => void
  onClick: (e: React.MouseEvent | React.TouchEvent) => void
  isSelected?: boolean
  selectionMode?: boolean
  disableSwipe?: boolean
  adaptiveAspect?: boolean
}

function TaskActionButton({
  tooltip,
  className,
  disabled = false,
  onClick,
  children,
}: {
  tooltip: string
  className: string
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false)

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
    >
      <button
        type="button"
        onClick={onClick}
        className={className}
        disabled={disabled}
        aria-label={tooltip}
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipVisible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

export default function TaskCard({
  task,
  onReuse,
  onEditOutputs,
  onDelete,
  onClick,
  isSelected,
  selectionMode = false,
  disableSwipe,
  adaptiveAspect = false,
}: Props) {
  const [thumbSrc, setThumbSrc] = useState<string>('')
  const [coverRatio, setCoverRatio] = useState<string>('')
  const [coverSize, setCoverSize] = useState<string>('')
  const [coverDims, setCoverDims] = useState<{ width: number; height: number } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [isSwiping, setIsSwiping] = useState(false)
  const [swipeStartedSelected, setSwipeStartedSelected] = useState(false)
  const [swipeActionActive, setSwipeActionActive] = useState(false)
  const [swipeDirection, setSwipeDirection] = useState<-1 | 0 | 1>(0)
  const [streamPreviewLoaded, setStreamPreviewLoaded] = useState(false)
  const toggleTaskSelection = useStore((s) => s.toggleTaskSelection)
  const settings = useStore((s) => s.settings)
  const openFavoritePicker = useStore((s) => s.openFavoritePicker)
  const streamPreviewSrc = useStore((s) => s.streamPreviews[task.id] || '')
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const swipeResetTimerRef = useRef<number | null>(null)
  const suppressClickUntilRef = useRef(0)
  const horizontalSwipeRef = useRef(false)
  const swipeDirectionRef = useRef<-1 | 0 | 1>(0)
  const swipeActionActiveRef = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const swipeOffsetRef = useRef(0)
  const pendingSwipeOffsetRef = useRef(0)
  const swipeFrameRef = useRef<number | null>(null)

  const updateSwipeDirection = (nextDirection: -1 | 0 | 1) => {
    if (swipeDirectionRef.current === nextDirection) return
    swipeDirectionRef.current = nextDirection
    setSwipeDirection(nextDirection)
  }

  const updateSwipeActionActive = (nextActive: boolean) => {
    if (swipeActionActiveRef.current === nextActive) return
    swipeActionActiveRef.current = nextActive
    setSwipeActionActive(nextActive)
  }

  const applySwipeOffset = (offset: number) => {
    swipeOffsetRef.current = offset
    if (cardRef.current) {
      cardRef.current.style.transform = offset ? `translateX(${offset}px)` : ''
    }
  }

  const cancelSwipeFrame = () => {
    if (swipeFrameRef.current != null) {
      window.cancelAnimationFrame(swipeFrameRef.current)
      swipeFrameRef.current = null
    }
  }

  const scheduleSwipeOffset = (offset: number) => {
    if (swipeFrameRef.current == null && swipeOffsetRef.current === offset) return
    pendingSwipeOffsetRef.current = offset
    if (swipeFrameRef.current != null) return
    swipeFrameRef.current = window.requestAnimationFrame(() => {
      swipeFrameRef.current = null
      applySwipeOffset(pendingSwipeOffsetRef.current)
    })
  }

  const isTagScrollTarget = (target: EventTarget | null) => {
    return target instanceof Element && Boolean(target.closest('[data-tag-scroll-area]'))
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disableSwipe || isTagScrollTarget(e.target)) {
      touchStartRef.current = null
      horizontalSwipeRef.current = false
      setIsSwiping(false)
      cancelSwipeFrame()
      applySwipeOffset(0)
      updateSwipeDirection(0)
      updateSwipeActionActive(false)
      return
    }

    if (swipeResetTimerRef.current != null) {
      window.clearTimeout(swipeResetTimerRef.current)
      swipeResetTimerRef.current = null
    }
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    horizontalSwipeRef.current = false
    setSwipeStartedSelected(Boolean(isSelected))
    updateSwipeActionActive(false)
    updateSwipeDirection(0)
    cancelSwipeFrame()
    applySwipeOffset(0)
    setIsSwiping(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isTagScrollTarget(e.target)) return
    if (!touchStartRef.current) return
    const deltaX = e.touches[0].clientX - touchStartRef.current.x
    const deltaY = e.touches[0].clientY - touchStartRef.current.y
    
    // 如果主要是水平滑动
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      horizontalSwipeRef.current = true
      e.preventDefault()
      // 限制滑动距离，例如最大 60px
      const boundedOffset = Math.max(-60, Math.min(60, deltaX))
      const nextDirection = boundedOffset > 0 ? 1 : boundedOffset < 0 ? -1 : 0
      const nextActionActive = Math.abs(deltaX) >= 40
      scheduleSwipeOffset(boundedOffset)
      updateSwipeDirection(nextDirection)
      updateSwipeActionActive(nextActionActive)
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isTagScrollTarget(e.target)) {
      touchStartRef.current = null
      horizontalSwipeRef.current = false
      setIsSwiping(false)
      cancelSwipeFrame()
      updateSwipeDirection(0)
      updateSwipeActionActive(false)
      return
    }

    setIsSwiping(false)
    cancelSwipeFrame()
    updateSwipeDirection(0)
    
    if (!touchStartRef.current) return
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x
    touchStartRef.current = null
    const isSwipeAction = horizontalSwipeRef.current && Math.abs(deltaX) > 40
    horizontalSwipeRef.current = false
    updateSwipeActionActive(isSwipeAction)
    swipeResetTimerRef.current = window.setTimeout(() => {
      updateSwipeActionActive(false)
      swipeResetTimerRef.current = null
    }, 220)

    // 如果是水平滑动，且垂直偏移较小，认为是滑动选择
    if (isSwipeAction) {
      suppressClickUntilRef.current = Date.now() + 350
      e.preventDefault()
      e.stopPropagation()
      toggleTaskSelection(task.id)
    }
  }

  const handleTouchCancel = () => {
    touchStartRef.current = null
    horizontalSwipeRef.current = false
    setIsSwiping(false)
    cancelSwipeFrame()
    updateSwipeDirection(0)
    updateSwipeActionActive(false)
  }

  useEffect(() => () => {
    if (swipeResetTimerRef.current != null) {
      window.clearTimeout(swipeResetTimerRef.current)
    }
    cancelSwipeFrame()
  }, [])

  useEffect(() => {
    if (!isSwiping) {
      applySwipeOffset(0)
    }
  }, [isSwiping])

  useEffect(() => {
    setStreamPreviewLoaded(false)
  }, [streamPreviewSrc, task.id])

  // 定时更新运行中任务的计时
  useEffect(() => {
    if (task.status !== 'running' && !(task.status === 'error' && (task.falRecoverable || task.customRecoverable))) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => clearInterval(id)
  }, [task.customRecoverable, task.falRecoverable, task.status])

  // 加载缩略图
  useEffect(() => {
    setCoverRatio('')
    setCoverSize('')
    setCoverDims(null)
    setThumbSrc('')

    let cancelled = false
    const imageId = task.outputImages?.[0]
    let unsubscribe: (() => void) | undefined

    const applyThumbnail = (thumbnail: { dataUrl: string; width?: number; height?: number }) => {
      if (cancelled) return
      setThumbSrc(thumbnail.dataUrl)
      if (thumbnail.width && thumbnail.height) {
        setCoverRatio(formatImageRatio(thumbnail.width, thumbnail.height))
        setCoverSize(`${thumbnail.width}×${thumbnail.height}`)
        setCoverDims({ width: thumbnail.width, height: thumbnail.height })
      }
    }

    if (imageId) {
      unsubscribe = subscribeImageThumbnail(imageId, applyThumbnail)
      ensureImageThumbnailCached(imageId).then((thumbnail) => {
        if (cancelled || !thumbnail) return
        applyThumbnail(thumbnail)
      }).catch(() => {
        if (!cancelled) setThumbSrc('')
      })
    }

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [task.outputImages])

  const duration = (() => {
    let seconds: number
    if (task.status === 'running' || task.falRecoverable || task.customRecoverable) {
      seconds = Math.floor((now - task.createdAt) / 1000)
    } else if (task.elapsed != null) {
      seconds = Math.floor(task.elapsed / 1000)
    } else {
      return '00:00'
    }
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
    const ss = String(seconds % 60).padStart(2, '0')
    return `${mm}:${ss}`
  })()
  const showSwipeAction = swipeActionActive
  const isFalReconnecting = task.status === 'error' && task.falRecoverable
  const isCustomReconnecting = task.status === 'error' && task.customRecoverable
  const showRunningTimer = task.status === 'running' || isFalReconnecting || isCustomReconnecting
  const swipeBgClass = showSwipeAction
    ? swipeStartedSelected
      ? 'bg-gray-500 dark:bg-gray-600'
      : 'bg-blue-500'
    : 'bg-gray-200 dark:bg-gray-700'

  const showTransparentOutput = task.transparentOutput || task.params.transparent_output
  const isTransparentOutput = Boolean(showTransparentOutput || (task.params as unknown as Record<string, unknown> | undefined)?.background === 'transparent')
  const outputErrorCount = task.outputErrors?.length ?? 0
  const outputSuccessCount = task.outputImages?.length ?? 0
  const requestedOutputCount = Math.max(task.params.n, outputSuccessCount + outputErrorCount)
  const hasPartialOutputFailure = task.status === 'done' && outputErrorCount > 0
  const isInterrupted = task.status === 'error' && task.error === '已停止生成。'

  return (
    <div className="relative rounded-2xl">
      {/* 侧滑底图 */}
      <div
        className={`absolute inset-0 rounded-2xl flex items-center transition-opacity duration-200 pointer-events-none ${
          isSwiping || swipeDirection !== 0 || swipeActionActive ? 'opacity-100' : 'opacity-0'
        } ${swipeBgClass} ${
          swipeDirection > 0 ? 'justify-start pl-6' : 'justify-end pr-6'
        }`}
      >
        <svg className={`w-8 h-8 transition-transform duration-150 ${showSwipeAction ? 'scale-110 text-white' : 'scale-90 text-white/60'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {swipeStartedSelected && showSwipeAction ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          )}
        </svg>
      </div>

      <div
        ref={cardRef}
        className={`studio-task-surface group relative rounded-2xl border overflow-hidden cursor-pointer touch-pan-y will-change-transform duration-200 ${
          !isSwiping ? 'transition-[box-shadow,border-color,background-color,transform]' : 'transition-[box-shadow,border-color,background-color]'
        } ${
          task.status === 'running'
            ? 'border-blue-400/80 generating'
            : isSelected
            ? 'studio-task-selected'
            : 'studio-task-neutral'
        }`}
        onClick={(e) => {
          if (Date.now() < suppressClickUntilRef.current) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
          onClick(e)
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        draggable={task.status === 'done' && task.outputImages?.length > 0}
        onDragStart={(e) => {
          if (task.status !== 'done' || !task.outputImages?.length) return;
          const imageIds = task.outputImages;
          e.dataTransfer.setData('text/plain', `agent-images:${imageIds.join(',')}`);
          e.dataTransfer.effectAllowed = 'copy';
          // Optionally set drag image if we have thumbSrc
          if (thumbSrc) {
            const preview = document.createElement('div');
            preview.style.cssText = 'position:fixed;left:-1000px;top:-1000px;width:100px;height:100px;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.25);';
            const previewImg = document.createElement('img');
            previewImg.src = thumbSrc;
            previewImg.style.cssText = 'width:100px;height:100px;object-fit:cover;display:block;';
            preview.appendChild(previewImg);
            document.body.appendChild(preview);
            e.dataTransfer.setDragImage(preview, 50, 50);
            setTimeout(() => preview.remove(), 0);
          }
        }}
      >
        {/* 批量选择勾选角标：选中态或选择模式下常驻右上角 */}
      {(selectionMode || isSelected) && (
        <button
          type="button"
          aria-label={isSelected ? '取消勾选此作品' : '勾选此作品'}
          aria-pressed={Boolean(isSelected)}
          onClick={(e) => {
            e.stopPropagation()
            toggleTaskSelection(task.id)
          }}
          className={`absolute top-2 right-2 z-20 flex h-6 w-6 items-center justify-center rounded-full border transition-all ${
            isSelected
              ? 'border-[#315b73] bg-[#315b73] text-white shadow-sm'
              : 'border-slate-400/70 bg-white/88 text-transparent hover:border-[#315b73] hover:bg-white shadow-sm backdrop-blur-md dark:border-white/35 dark:bg-gray-900/75 dark:hover:border-blue-400'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.75} d="M5 13l4 4L19 7" />
          </svg>
        </button>
      )}
      <div className="studio-task-layout">
        {/* 左侧图片区域 */}
        <div
          className={`studio-task-media relative flex items-center justify-center overflow-hidden shrink-0${adaptiveAspect ? ' studio-task-media-adaptive' : ''}`}
          style={{
            ...(isTransparentOutput ? {
              backgroundImage: 'linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
            } : undefined),
            ...(adaptiveAspect && task.status === 'done' && thumbSrc && coverDims && coverDims.width > 0 && coverDims.height > 0 ? {
              aspectRatio: `${Math.min(2.4, Math.max(0.65, coverDims.width / coverDims.height))}`,
            } : undefined),
          }}
        >
          {task.status === 'running' && streamPreviewSrc && (
            <>
              <img
                src={streamPreviewSrc}
                className={`h-full w-full object-contain ${streamPreviewLoaded ? '' : 'hidden'}`}
                alt=""
                onLoad={() => setStreamPreviewLoaded(true)}
                onError={() => setStreamPreviewLoaded(false)}
              />
              {streamPreviewLoaded && (
                <span className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded bg-blue-500 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm sm:text-xs">
                  预览
                </span>
              )}
            </>
          )}
          {task.status === 'running' && (!streamPreviewSrc || !streamPreviewLoaded) && (
            <div className="flex flex-col items-center gap-2">
              <svg
                className="w-8 h-8 text-blue-400 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span className="text-xs text-gray-400 dark:text-gray-500">生成中...</span>
            </div>
          )}
          {task.status === 'error' && isFalReconnecting && (
            <div className="flex flex-col items-center gap-1 px-2">
              <svg
                className="w-7 h-7 text-yellow-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span className="text-xs text-yellow-500 text-center leading-tight">
                重连中
              </span>
            </div>
          )}
          {task.status === 'error' && !isFalReconnecting && (
            <div className="flex flex-col items-center gap-1.5 px-4 text-center">
              <svg
                className={`w-7 h-7 ${isInterrupted ? 'text-amber-500' : 'text-red-400'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className={`text-xs font-medium leading-tight ${isInterrupted ? 'text-amber-600 dark:text-amber-400' : 'text-red-500 dark:text-red-400'}`}>
                {isInterrupted ? '已停止' : '生成失败'}
              </span>
              {task.error && !isInterrupted && (
                <p className="max-w-full truncate text-[11px] text-gray-400 dark:text-gray-500" title={task.error}>
                  {task.error}
                </p>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void retryTask(task)
                }}
                className="mt-1 rounded-full border border-gray-200/80 bg-white/90 px-3 py-1 text-[11px] font-medium text-gray-600 transition hover:bg-white hover:text-gray-900 dark:border-white/10 dark:bg-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.14]"
              >
                重试
              </button>
            </div>
          )}
          {task.status === 'done' && thumbSrc && (
            <>
              <img
                src={thumbSrc}
                data-image-id={task.outputImages[0]}
                data-output-image-ids={task.outputImages.join(',')}
                className="saveable-image w-full h-full object-contain"
                loading="lazy"
                alt=""
              />
              {(hasPartialOutputFailure || task.outputImages.length > 1) && (
                <span className="studio-task-glass-pill absolute bottom-2 right-2 z-10 px-2 py-0.5 text-[11px] font-medium tabular-nums">
                  {hasPartialOutputFailure ? <>{requestedOutputCount} | <span className="font-semibold text-amber-500 dark:text-amber-300">{outputSuccessCount}</span></> : task.outputImages.length}
                </span>
              )}
            </>
          )}
          {task.status === 'done' && !thumbSrc && (
            <svg
              className="w-8 h-8 text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          )}

          {/* 状态/规格徽章：与右上操作条统一采用同款毛玻璃胶囊，运行中常驻左上耗时，完成后悬停于左下轻柔浮现 */}
          {(showRunningTimer || task.status !== 'done' || (coverRatio && coverSize)) && (
            <div
              className={`absolute left-2 z-10 flex items-center gap-1 pointer-events-none ${
                showRunningTimer || task.status !== 'done'
                  ? 'top-2 opacity-100'
                  : 'bottom-2 studio-task-hover-reveal'
              }`}
            >
              {showRunningTimer || task.status !== 'done' || !coverRatio || !coverSize ? (
                <span className="studio-task-glass-pill flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium tabular-nums">
                  <svg className="w-3 h-3 opacity-75" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {duration}
                </span>
              ) : (
                <span className="studio-task-glass-pill px-2.5 py-1 text-[11px] font-medium tabular-nums">
                  {coverRatio} · {coverSize}
                </span>
              )}
            </div>
          )}

          {/* 已收藏的轻星标（默认态仅显一颗克制金星，悬停时无缝切换为操作条；批量选择态隐藏避免与勾选框重叠） */}
          {task.isFavorite && !isSelected && !selectionMode && (
            <span
              aria-hidden="true"
              className="studio-task-favorite-pill pointer-events-none absolute top-2 right-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full text-amber-400 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                />
              </svg>
            </span>
          )}

          {/* 右上角悬停操作条（选中态或批量选择模式隐藏，避免遮挡勾选角标或误触） */}
          {!isSelected && !selectionMode && (
            <div className="studio-task-actions">
              <div
                data-tag-scroll-area
                className="flex items-center gap-0.5 flex-shrink-0 max-w-full overflow-x-auto hide-scrollbar"
                onClick={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                onTouchCancel={(e) => e.stopPropagation()}
              >
                {((task.status === 'error' && !isFalReconnecting) || settings.alwaysShowRetryButton) && (
                  <TaskActionButton
                    tooltip="重试任务"
                    onClick={() => retryTask(task)}
                    className="p-1.5 rounded-full hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-gray-500 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </TaskActionButton>
                )}
                <TaskActionButton
                  tooltip={task.isFavorite ? '编辑收藏夹' : '收藏任务'}
                  onClick={() => openFavoritePicker([task.id])}
                  className={`p-1.5 rounded-full transition ${
                    task.isFavorite
                      ? 'text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10'
                      : 'text-gray-500 dark:text-gray-300 hover:text-amber-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.1]'
                  }`}
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill={task.isFavorite ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                    />
                  </svg>
                </TaskActionButton>
                <TaskActionButton
                  tooltip="复用配置"
                  onClick={onReuse}
                  className="p-1.5 rounded-full hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                    />
                  </svg>
                </TaskActionButton>
                <TaskActionButton
                  tooltip="编辑输出"
                  onClick={onEditOutputs}
                  className="p-1.5 rounded-full hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition disabled:opacity-30"
                  disabled={!task.outputImages?.length}
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    />
                  </svg>
                </TaskActionButton>
                <TaskActionButton
                  tooltip="删除任务"
                  onClick={onDelete}
                  className="p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-950/40 text-gray-500 dark:text-gray-300 hover:text-red-500 dark:hover:text-red-400 transition"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </TaskActionButton>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}
