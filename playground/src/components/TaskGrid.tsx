import { useCallback, useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react'
import { useStore, reuseConfig, editOutputs, removeTask, taskMatchesFilterStatus, taskMatchesSearchQuery } from '../store'
import { ALL_FAVORITES_COLLECTION_ID, getTaskFavoriteCollectionIds } from '../lib/favoriteState'
import { computeGalleryColumns, getGalleryDensitySpec } from '../lib/galleryDensity'
import { computeMasonryLayout, getVisibleMasonryItems, type ImageDimensions, type MasonryItemLayout } from '../lib/galleryMasonry'
import { getCachedImageDimensions } from '../lib/imageCache'
import TaskCard from './TaskCard'

export default function TaskGrid() {
  const tasks = useStore((s) => s.tasks)
  const searchQuery = useStore((s) => s.searchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const galleryDensity = useStore((s) => s.galleryDensity)
  const galleryLayout = useStore((s) => s.galleryLayout)
  const densitySpec = getGalleryDensitySpec(galleryDensity)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const defaultFavoriteCollectionId = useStore((s) => s.defaultFavoriteCollectionId)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const gallerySelectionMode = useStore((s) => s.gallerySelectionMode)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const isSelectionActive = gallerySelectionMode || selectedTaskIds.length > 0
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const rootRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [selectionBox, setSelectionBox] = useState<{ startPageX: number; startPageY: number; currentPageX: number; currentPageY: number } | null>(null)
  const [viewportVersion, setViewportVersion] = useState(0)
  const dragStart = useRef<{ pageX: number; pageY: number } | null>(null)
  const lastClientPoint = useRef<{ x: number; y: number } | null>(null)
  const hasDragged = useRef(false)
  const isDragging = useRef(false)
  const dragScrollIntervalRef = useRef<number | null>(null)
  const dragScrollDirectionRef = useRef<-1 | 1 | null>(null)
  const lastToastTimeRef = useRef(0)
  const suppressClickUntil = useRef(0)
  const startedOnCard = useRef(false)
  const startedWithCtrl = useRef(false)
  const initialSelection = useRef<string[]>([])
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)

  useEffect(() => {
    let frame = 0
    const invalidate = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        setViewportVersion((value) => value + 1)
      })
    }
    window.addEventListener('scroll', invalidate, { passive: true })
    window.addEventListener('resize', invalidate)
    invalidate()
    return () => {
      window.removeEventListener('scroll', invalidate)
      window.removeEventListener('resize', invalidate)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

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

  const [columns, setColumns] = useState(densitySpec.mobileColumns)
  const [containerWidth, setContainerWidth] = useState(0)
  const [measuredDimensions, setMeasuredDimensions] = useState<Map<string, ImageDimensions>>(() => new Map())
  const pendingDimensionsRef = useRef<Map<string, ImageDimensions>>(new Map())
  const dimensionsFrameRef = useRef<number | null>(null)

  const handleCoverDimensions = useCallback((imageId: string, dims: ImageDimensions) => {
    if (!imageId || !(dims.width > 0 && dims.height > 0)) return
    const existing = pendingDimensionsRef.current.get(imageId)
    if (existing && existing.width === dims.width && existing.height === dims.height) return
    pendingDimensionsRef.current.set(imageId, dims)
    if (dimensionsFrameRef.current != null) return
    dimensionsFrameRef.current = window.requestAnimationFrame(() => {
      dimensionsFrameRef.current = null
      const pending = pendingDimensionsRef.current
      if (pending.size === 0) return
      setMeasuredDimensions((prev) => {
        let changed = false
        for (const [id, nextDims] of pending) {
          const prevDims = prev.get(id)
          if (!prevDims || prevDims.width !== nextDims.width || prevDims.height !== nextDims.height) {
            changed = true
            break
          }
        }
        if (!changed) return prev
        const next = new Map(prev)
        for (const [id, nextDims] of pending) {
          next.set(id, nextDims)
        }
        return next
      })
      pending.clear()
    })
  }, [])

  useEffect(() => () => {
    if (dimensionsFrameRef.current != null) {
      window.cancelAnimationFrame(dimensionsFrameRef.current)
      dimensionsFrameRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    // 使用内容区宽度与当前画廊密度，同时驱动瀑布流/方格布局、虚拟滚动和框选计算。
    const resize = () => {
      const width = root.clientWidth
      setContainerWidth(width)
      setColumns(computeGalleryColumns(width, galleryDensity))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(root)
    resize()
    return () => observer.disconnect()
  }, [filteredTasks.length > 0, galleryDensity])

  const effectiveDimensions = useMemo(() => {
    const map = new Map<string, ImageDimensions>(measuredDimensions)
    for (const task of filteredTasks) {
      const coverId = task.outputImages?.[0]
      if (!coverId || map.has(coverId)) continue
      const cached = getCachedImageDimensions(coverId)
      if (cached) map.set(coverId, cached)
    }
    return map
  }, [filteredTasks, measuredDimensions])

  const isMasonryActive = galleryLayout === 'masonry' && containerWidth > 0
  const masonryLayout = useMemo(() => {
    if (!isMasonryActive) return null
    return computeMasonryLayout(filteredTasks, {
      containerWidth,
      columns,
      gap: densitySpec.gap,
      dimensionsByImageId: effectiveDimensions,
    })
  }, [isMasonryActive, filteredTasks, containerWidth, columns, densitySpec.gap, effectiveDimensions])

  const virtualize = filteredTasks.length > 80
  const totalRows = Math.ceil(filteredTasks.length / columns)
  // 卡片高度随列宽变化，通过实测已渲染卡片高度作为方格虚拟列表行高基准。
  const rowMetricsRef = useRef({ height: densitySpec.estimatedCardHeight, gap: densitySpec.gap })
  const [metricsVersion, setMetricsVersion] = useState(0)
  const estimatedRowHeight = rowMetricsRef.current.height + rowMetricsRef.current.gap
  const marqueeLayoutRef = useRef<{
    columns: number
    gap: number
    estimatedRowHeight: number
    filteredTasks: typeof filteredTasks
    masonryItems: MasonryItemLayout[] | null
  }>({ columns, gap: densitySpec.gap, estimatedRowHeight, filteredTasks, masonryItems: masonryLayout?.items ?? null })
  marqueeLayoutRef.current = {
    columns,
    gap: densitySpec.gap,
    estimatedRowHeight,
    filteredTasks,
    masonryItems: masonryLayout?.items ?? null,
  }
  const rootTop = rootRef.current ? rootRef.current.getBoundingClientRect().top + window.scrollY : 0
  const relativeScroll = Math.max(0, window.scrollY - rootTop)
  const firstVisibleRow = virtualize ? Math.max(0, Math.floor(relativeScroll / estimatedRowHeight) - 2) : 0
  const lastVisibleRow = virtualize ? Math.min(totalRows, Math.ceil((relativeScroll + window.innerHeight) / estimatedRowHeight) + 3) : totalRows
  const visibleStart = firstVisibleRow * columns
  const visibleEnd = Math.min(filteredTasks.length, lastVisibleRow * columns)
  const visibleTasks = virtualize ? filteredTasks.slice(visibleStart, visibleEnd) : filteredTasks
  const visibleMasonryItems = useMemo(() => {
    if (!masonryLayout) return []
    if (!virtualize) return masonryLayout.items
    const overscanPx = Math.max(640, window.innerHeight * 0.75)
    return getVisibleMasonryItems(masonryLayout.items, relativeScroll, relativeScroll + window.innerHeight, overscanPx)
  }, [masonryLayout, virtualize, relativeScroll, viewportVersion])

  // 实测已渲染卡片的高度与行间距，作为方格虚拟列表的行高基准。
  // 虚拟列表自带 ±2 行余量，实测值随滚动逐步收敛即可，不必精确到像素。
  useLayoutEffect(() => {
    if (isMasonryActive) return
    const grid = gridRef.current
    if (!grid) return
    const cards = grid.querySelectorAll<HTMLElement>('.task-card-wrapper')
    const offsets = Array.from(cards, (card) => card.offsetTop)
    const rows = new Map<number, { top: number; bottom: number }>()
    cards.forEach((card, index) => {
      const top = offsets[index]
      const bottom = top + card.offsetHeight
      const row = rows.get(top)
      if (row) row.bottom = Math.max(row.bottom, bottom)
      else rows.set(top, { top, bottom })
    })
    const sorted = Array.from(rows.values()).sort((a, b) => a.top - b.top)
    const heights = sorted.map((row) => row.bottom - row.top).sort((a, b) => a - b)
    if (!heights.length) return
    const height = heights[Math.floor(heights.length / 2)]
    const gaps = sorted.slice(1).map((row, index) => row.top - sorted[index].bottom).filter((gap) => gap >= 0)
    const gap = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : rowMetricsRef.current.gap
    const prev = rowMetricsRef.current
    if (Math.abs(prev.height - height) < 2 && Math.abs(prev.gap - gap) < 2) return
    rowMetricsRef.current = { height, gap }
    setMetricsVersion((value) => value + 1)
  })

  // 列数变化（卡片宽度改变）时重置行高基准。不要按任务数量重置：删除/新增任务
  // 会让基准回落到默认估算值（276px），与真实行高（约 430px）偏差过大，占位块
  // 高度骤变导致文档高度剧烈变化，浏览器钳制 scrollTop，页面表现为自己乱跳。
  useEffect(() => {
    rowMetricsRef.current = { height: densitySpec.estimatedCardHeight, gap: densitySpec.gap }
    setMetricsVersion((value) => value + 1)
  }, [columns, densitySpec.estimatedCardHeight, densitySpec.gap])

  // 删除任务后把锚点卡片吸回原位：删除会让后续卡片整体上移一行，浏览器还可能
  // 因文档变矮钳制 scrollTop。这里在浏览器绘制前把差值补回，消除视觉跳动。
  const anchorRef = useRef<{ id: string; top: number } | null>(null)
  const prevTaskCountRef = useRef(tasks.length)

  // 声明在捕获之前：删除提交时先用上一帧的锚点位置补偿，再刷新锚点。
  useLayoutEffect(() => {
    const shrank = tasks.length < prevTaskCountRef.current
    prevTaskCountRef.current = tasks.length
    if (!shrank) return
    const anchor = anchorRef.current
    if (!anchor) return
    const el = gridRef.current?.querySelector<HTMLElement>(
      `[data-task-id="${CSS.escape(anchor.id)}"]`,
    )
    if (!el) return
    const delta = el.getBoundingClientRect().top + window.scrollY - anchor.top
    if (Math.abs(delta) > 2) {
      window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' })
    }
  }, [tasks])

  // 每次渲染后记录当前首张可见卡片的位置，作为下一次删除的滚动锚点。
  useLayoutEffect(() => {
    const first = gridRef.current?.querySelector<HTMLElement>('[data-task-id]')
    anchorRef.current = first?.dataset.taskId
      ? { id: first.dataset.taskId, top: first.getBoundingClientRect().top + window.scrollY }
      : null
  })

  const handleDelete = (task: typeof tasks[0]) => {
    setConfirmDialog({
      title: '删除任务',
      message: '确定要删除这个任务吗？关联的图片资源也会被清理（如果没有其他任务引用）。',
      action: () => removeTask(task),
    })
  }

  const renderTaskCard = (task: typeof tasks[0], masonryItem?: MasonryItemLayout) => (
    <TaskCard
      task={task}
      onClick={(e) => {
        if (Date.now() < suppressClickUntil.current) {
          e.preventDefault()
          return
        }
        suppressClickUntil.current = 0
        const isCtrl = isMac ? e.metaKey : e.ctrlKey
        if (isCtrl || isSelectionActive) {
          useStore.getState().toggleTaskSelection(task.id)
          return
        }

        setDetailTaskId(task.id)
      }}
      onReuse={() => reuseConfig(task)}
      onEditOutputs={() => editOutputs(task)}
      onDelete={() => handleDelete(task)}
      isSelected={selectedTaskIds.includes(task.id)}
      selectionMode={isSelectionActive}
      fillContainer={Boolean(masonryItem)}
      imageFit={masonryItem ? (masonryItem.isHeightCapped ? 'cover-top' : 'cover') : 'contain'}
      isHeightCapped={Boolean(masonryItem?.isHeightCapped)}
      onCoverDimensions={handleCoverDimensions}
    />
  )

  const renderTask = (task: typeof tasks[0]) => (
    <div key={task.id} className="task-card-wrapper" data-task-id={task.id}>
      {renderTaskCard(task)}
    </div>
  )

  const renderMasonryItem = (item: MasonryItemLayout) => {
    const task = filteredTasks[item.index]
    if (!task) return null
    return (
      <div
        key={task.id}
        className="task-card-wrapper absolute"
        data-task-id={task.id}
        data-masonry-col={item.column}
        style={{
          left: `${item.left}px`,
          top: `${item.top}px`,
          width: `${item.width}px`,
          height: `${item.height}px`,
        }}
      >
        {renderTaskCard(task, item)}
      </div>
    )
  }

  const getPagePoint = (clientX: number, clientY: number) => ({
    pageX: clientX + window.scrollX,
    pageY: clientY + window.scrollY,
  })

  const beginSelection = (target: HTMLElement, clientX: number, clientY: number, isCtrl: boolean) => {
    const point = getPagePoint(clientX, clientY)

    startedOnCard.current = Boolean(target.closest('.task-card-wrapper'))
    startedWithCtrl.current = isCtrl
    initialSelection.current = [...useStore.getState().selectedTaskIds]

    isDragging.current = true
    hasDragged.current = false
    dragStart.current = point
    lastClientPoint.current = { x: clientX, y: clientY }
    document.body.classList.add('select-none')
    document.body.classList.add('drag-selecting')
    setSelectionBox({
      startPageX: point.pageX,
      startPageY: point.pageY,
      currentPageX: point.pageX,
      currentPageY: point.pageY,
    })
  }

  const updateSelectionFromPoint = (pageX: number, pageY: number) => {
    const start = dragStart.current
    if (!start || !gridRef.current) return

    const minX = Math.min(start.pageX, pageX)
    const maxX = Math.max(start.pageX, pageX)
    const minY = Math.min(start.pageY, pageY)
    const maxY = Math.max(start.pageY, pageY)

    const newSelected = new Set(initialSelection.current)
    const initialSelected = new Set(initialSelection.current)

    // 虚拟列表只把视口附近的卡片挂到 DOM；框选必须按完整任务数组计算，
    // 否则拖选跨过未渲染区域时会漏选。已渲染卡片仍使用真实尺寸，减少估算误差。
    const renderedCards = gridRef.current.querySelectorAll<HTMLElement>('.task-card-wrapper')
    const renderedRects = new Map<string, DOMRect>()
    renderedCards.forEach((card) => {
      const taskId = card.getAttribute('data-task-id')
      if (taskId) renderedRects.set(taskId, card.getBoundingClientRect())
    })
    const rootRect = rootRef.current?.getBoundingClientRect()
    const gridWidth = rootRect?.width ?? gridRef.current.clientWidth
    const {
      columns: liveColumns,
      gap,
      estimatedRowHeight: liveRowHeight,
      filteredTasks: liveTasks,
      masonryItems,
    } = marqueeLayoutRef.current
    const rootPageLeft = (rootRect?.left ?? 0) + window.scrollX
    const rootPageTop = (rootRect?.top ?? 0) + window.scrollY

    if (masonryItems && masonryItems.length > 0) {
      masonryItems.forEach((item) => {
        const rendered = renderedRects.get(item.id)
        const cardLeft = rendered ? rendered.left + window.scrollX : rootPageLeft + item.left
        const cardTop = rendered ? rendered.top + window.scrollY : rootPageTop + item.top
        const cardRight = rendered ? rendered.right + window.scrollX : rootPageLeft + item.right
        const cardBottom = rendered ? rendered.bottom + window.scrollY : rootPageTop + item.bottom
        const isIntersecting = minX < cardRight && maxX > cardLeft && minY < cardBottom && maxY > cardTop

        if (isIntersecting) {
          if (initialSelected.has(item.id)) newSelected.delete(item.id)
          else newSelected.add(item.id)
        } else if (!initialSelected.has(item.id)) {
          newSelected.delete(item.id)
        }
      })
    } else {
      const cardWidth = Math.max(0, (gridWidth - gap * (liveColumns - 1)) / liveColumns)

      liveTasks.forEach((task, index) => {
        const rendered = renderedRects.get(task.id)
        const row = Math.floor(index / liveColumns)
        const column = index % liveColumns
        const cardLeft = rendered
          ? rendered.left + window.scrollX
          : rootPageLeft + column * (cardWidth + gap)
        const cardTop = rendered
          ? rendered.top + window.scrollY
          : rootPageTop + row * liveRowHeight
        const cardRight = rendered ? rendered.right + window.scrollX : cardLeft + cardWidth
        const cardBottom = rendered ? rendered.bottom + window.scrollY : cardTop + liveRowHeight - gap
        const isIntersecting = minX < cardRight && maxX > cardLeft && minY < cardBottom && maxY > cardTop

        if (isIntersecting) {
          if (initialSelected.has(task.id)) newSelected.delete(task.id)
          else newSelected.add(task.id)
        } else if (!initialSelected.has(task.id)) {
          newSelected.delete(task.id)
        }
      })
    }

    setSelectedTaskIds(Array.from(newSelected))
  }

  useEffect(() => {
    const stopDragScroll = () => {
      if (dragScrollIntervalRef.current) {
        clearInterval(dragScrollIntervalRef.current)
        dragScrollIntervalRef.current = null
      }
      dragScrollDirectionRef.current = null
    }

    const startDragScroll = (direction: -1 | 1) => {
      if (dragScrollIntervalRef.current && dragScrollDirectionRef.current === direction) return
      stopDragScroll()
      dragScrollDirectionRef.current = direction
      dragScrollIntervalRef.current = window.setInterval(() => {
        window.scrollBy({ top: direction * 15, behavior: 'instant' })
      }, 16)
    }

    const endSelection = (clearEmptySurfaceClick = false, suppressClick = false) => {
      if (isDragging.current) {
        document.body.classList.remove('select-none')
        document.body.classList.remove('drag-selecting')
      }
      if (isDragging.current && clearEmptySurfaceClick && !hasDragged.current && !startedOnCard.current && !startedWithCtrl.current && !useStore.getState().gallerySelectionMode) {
        clearSelection()
      }
      if (isDragging.current && suppressClick && hasDragged.current) {
        suppressClickUntil.current = Date.now() + 250
      }
      stopDragScroll()
      isDragging.current = false
      dragStart.current = null
      lastClientPoint.current = null
      setSelectionBox(null)
    }

    const getEventElement = (e: MouseEvent) => {
      if (e.target instanceof Element) return e.target
      return document.elementFromPoint(e.clientX, e.clientY)
    }

    const handleDocumentMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const target = getEventElement(e)
      if (!target) return
      if (!target.closest('[data-drag-select-surface]')) return
      if (target.closest('[data-input-bar]')) return
      if (target.closest('[data-no-drag-select], [data-lightbox-root]')) return
      if (target.closest('button, a, input, textarea, select')) return

      const isCtrl = isMac ? e.metaKey : e.ctrlKey
      beginSelection(target as HTMLElement, e.clientX, e.clientY, isCtrl)
      e.preventDefault()
    }

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !dragStart.current) return

      const start = dragStart.current
      const point = getPagePoint(e.clientX, e.clientY)
      lastClientPoint.current = { x: e.clientX, y: e.clientY }
      const distance = Math.hypot(point.pageX - start.pageX, point.pageY - start.pageY)
      if (distance < 6 && !hasDragged.current) return

      hasDragged.current = true
      setSelectionBox({
        startPageX: start.pageX,
        startPageY: start.pageY,
        currentPageX: point.pageX,
        currentPageY: point.pageY,
      })
      updateSelectionFromPoint(point.pageX, point.pageY)
      e.preventDefault()

      const scrollThreshold = 40
      if (e.clientY < scrollThreshold) {
        startDragScroll(-1)
      } else if (e.clientY > window.innerHeight - scrollThreshold) {
        startDragScroll(1)
      } else {
        stopDragScroll()
      }
    }

    const handleDocumentScroll = () => {
      if (!isDragging.current || !dragStart.current || !lastClientPoint.current || !hasDragged.current) return

      const point = getPagePoint(lastClientPoint.current.x, lastClientPoint.current.y)
      const start = dragStart.current
      setSelectionBox({
        startPageX: start.pageX,
        startPageY: start.pageY,
        currentPageX: point.pageX,
        currentPageY: point.pageY,
      })
      updateSelectionFromPoint(point.pageX, point.pageY)
    }

    const handleDocumentWheel = (e: WheelEvent) => {
      if (!isDragging.current) return
      if ((e.buttons & 1) === 0) {
        endSelection()
        return
      }
      if (!hasDragged.current) return
      if (!e.ctrlKey && !e.metaKey) return

      e.preventDefault()
      const now = Date.now()
      if (now - lastToastTimeRef.current > 3000) {
        lastToastTimeRef.current = now
        const keyName = isMac ? '⌘' : 'Ctrl'
        useStore.getState().showToast(`松开 ${keyName} 键使用滚轮，或拖至边缘自动滚动`, 'info')
      }
    }

    const handleDocumentMouseUp = () => {
      endSelection(true, true)
    }

    document.addEventListener('mousedown', handleDocumentMouseDown, true)
    document.addEventListener('mousemove', handleDocumentMouseMove, true)
    document.addEventListener('mouseup', handleDocumentMouseUp, true)
    document.addEventListener('wheel', handleDocumentWheel, { capture: true, passive: false })
    window.addEventListener('scroll', handleDocumentScroll, true)
    return () => {
      stopDragScroll()
      document.removeEventListener('mousedown', handleDocumentMouseDown, true)
      document.removeEventListener('mousemove', handleDocumentMouseMove, true)
      document.removeEventListener('mouseup', handleDocumentMouseUp, true)
      document.removeEventListener('wheel', handleDocumentWheel, true)
      window.removeEventListener('scroll', handleDocumentScroll, true)
    }
  }, [clearSelection, isMac])

  if (!filteredTasks.length) {
    return (
      <div className="studio-gallery-empty">
        {searchQuery || filterFavorite || filterStatus !== 'all' ? (
          <p>没有找到匹配的作品</p>
        ) : (
          <>
            <div className="studio-empty-illustration" aria-hidden="true">
            <svg
              className="h-8 w-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            </div>
            <h2 className="studio-empty-title">还没有作品</h2>
            <p className="studio-empty-description">在下方输入提示词，开始创作。</p>
          </>
        )}
      </div>
    )
  }

  return (
    <div 
      ref={rootRef}
      data-task-grid-root
      className="relative min-h-[50vh]"
    >
      <div ref={gridRef}>
        {isMasonryActive && masonryLayout ? (
          <div
            data-density={galleryDensity}
            data-layout="masonry"
            className="relative"
            style={{ height: `${masonryLayout.totalHeight + 40}px` }}
          >
            {visibleMasonryItems.map(renderMasonryItem)}
          </div>
        ) : (
          <>
            {virtualize && <div aria-hidden style={{ height: firstVisibleRow * estimatedRowHeight + rowMetricsRef.current.gap }} />}
            <div
              data-density={galleryDensity}
              data-layout="grid"
              className="grid pb-10"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${densitySpec.gap}px` }}
            >
              {visibleTasks.map(renderTask)}
            </div>
            {virtualize && <div aria-hidden style={{ height: Math.max(0, (totalRows - lastVisibleRow) * estimatedRowHeight - rowMetricsRef.current.gap) + 40 }} />}
          </>
        )}
      </div>
      {selectionBox && (
        <div
          className="fixed bg-blue-500/20 border border-blue-500/50 pointer-events-none z-[30]"
          style={{
            left: Math.min(selectionBox.startPageX, selectionBox.currentPageX) - window.scrollX,
            top: Math.min(selectionBox.startPageY, selectionBox.currentPageY) - window.scrollY,
            width: Math.abs(selectionBox.currentPageX - selectionBox.startPageX),
            height: Math.abs(selectionBox.currentPageY - selectionBox.startPageY),
          }}
        />
      )}
    </div>
  )
}
