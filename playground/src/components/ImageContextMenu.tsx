import React, { useEffect, useState, useRef } from 'react'
import { useStore, addImageFromUrl } from '../store'
import { canCopyImageToClipboard, copyImageSourceToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { downloadImageEntriesAsZip, downloadImageIds, formatExportFileTime, getImageZipEntries } from '../lib/downloadImages'
import { suppressGlobalClicks } from '../lib/clickSuppression'
import { ensureImageCached } from '../lib/imageCache'
import { CopyIcon, DownloadIcon, EditIcon, ExportIcon, TrashIcon, ArrowDownIcon, LinkIcon } from './icons'

export default function ImageContextMenu() {
  const [menuInfo, setMenuInfo] = useState<{ src: string; imageId?: string; outputImageIds: string[]; canCopyImage: boolean; x: number; y: number } | null>(null)
  const showToast = useStore((s) => s.showToast)
  const inputImages = useStore((s) => s.inputImages)
  const appMode = useStore((s) => s.appMode)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isEmbeddedPage()) return

    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target && target.tagName === 'IMG') {
        const imgTarget = target as HTMLImageElement
        // 忽略没有 src 或空的 img
        if (!imgTarget.src) return

        // iOS 触控设备上，放行原生长按菜单（以支持原生保存图片）
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
        const isTouch = window.matchMedia('(pointer: coarse)').matches
        if (isIOS && isTouch) return

        const canCopyImage = canCopyImageToClipboard()
        // 非安全上下文没有图片剪贴板 API；原图区域放行原生菜单，缩略图仍保留下载/编辑能力。
        if (!canCopyImage && imgTarget.classList.contains('object-contain')) return

        e.preventDefault()
        setMenuInfo({
          src: imgTarget.src,
          imageId: imgTarget.dataset.imageId,
          outputImageIds: imgTarget.dataset.outputImageIds?.split(',').filter(Boolean) ?? [],
          canCopyImage,
          x: e.clientX,
          y: e.clientY,
        })
      }
    }

    // 监听全局 contextmenu，兼容桌面端右键和大部分移动端长按
    window.addEventListener('contextmenu', onContextMenu)
    return () => {
      window.removeEventListener('contextmenu', onContextMenu)
    }
  }, [])

  // 点击其他地方、滚动或缩放时关闭菜单
  useEffect(() => {
    if (!menuInfo) return
    const close = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return
      }
      if (e.target instanceof Element && e.target.closest('[data-lightbox-root]')) {
        window.dispatchEvent(new Event('image-context-menu-dismiss-lightbox-click'))
      }
      if (e.type === 'mousedown' || e.type === 'touchstart') suppressGlobalClicks()
      setMenuInfo(null)
    }
    window.addEventListener('mousedown', close, { capture: true })
    window.addEventListener('touchstart', close, { capture: true })
    window.addEventListener('wheel', close, { capture: true })
    window.addEventListener('scroll', close, { capture: true })
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close, { capture: true })
      window.removeEventListener('touchstart', close, { capture: true })
      window.removeEventListener('wheel', close, { capture: true })
      window.removeEventListener('scroll', close, { capture: true })
      window.removeEventListener('resize', close)
    }
  }, [menuInfo])

  if (!menuInfo) return null

  const getOriginalImageSrc = async () => {
    if (!menuInfo.imageId) return menuInfo.src
    return await ensureImageCached(menuInfo.imageId) ?? menuInfo.src
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuInfo(null)
    try {
      await copyImageSourceToClipboard(getOriginalImageSrc())
      showToast('图片已复制', 'success')
    } catch (err) {
      console.error(err)
      showToast(getClipboardFailureMessage('复制失败', err), 'error')
    }
  }

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const imageId = menuInfo.imageId
    const src = menuInfo.src
    setMenuInfo(null)

    try {
      let fileNameBase = ''
      if (imageId) {
        const tasks = useStore.getState().tasks
        const matchedTask = tasks.find(t => t.outputImages?.includes(imageId))
        if (matchedTask) {
          fileNameBase = `task-${matchedTask.id}`
        } else {
          fileNameBase = `image-${imageId}`
        }
      } else {
        const timeStr = formatExportFileTime(new Date())
        fileNameBase = `image-${timeStr}`
      }

      const result = await downloadImageIds([imageId || src], fileNameBase)
      if (result.successCount === 0) {
        showToast('下载失败', 'error')
      } else {
        showToast('下载成功', 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
  }

  const handleDownloadAll = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const outputImageIds = menuInfo.outputImageIds
    setMenuInfo(null)
    if (outputImageIds.length <= 1) return

    try {
      let fileNameBase = ''
      if (outputImageIds[0]) {
        const tasks = useStore.getState().tasks
        const matchedTask = tasks.find(t => t.outputImages?.includes(outputImageIds[0]))
        if (matchedTask) {
          fileNameBase = `task-${matchedTask.id}`
        }
      }
      if (!fileNameBase) {
        const timeStr = formatExportFileTime(new Date())
        fileNameBase = `batch-${timeStr}`
      }

      const settings = useStore.getState().settings
      const result = settings.zipDownloadRoutes.includes('image-context-menu-all')
        ? await downloadImageEntriesAsZip(getImageZipEntries(outputImageIds, fileNameBase), fileNameBase)
        : await downloadImageIds(outputImageIds, fileNameBase)
      if (result.successCount === 0) {
        showToast('下载失败', 'error')
      } else if (result.failCount > 0) {
        showToast(`部分下载失败：成功 ${result.successCount}，失败 ${result.failCount}`, 'error')
      } else {
        showToast(result.successCount > 1 ? `下载成功：${result.successCount} 张图片` : '下载成功', 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
  }

  const handleEdit = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setMenuInfo(null)
    if (inputImages.length >= 16) {
      showToast('参考图数量已达上限（16 张），无法继续添加', 'error')
      return
    }

    try {
      const src = await getOriginalImageSrc()
      await addImageFromUrl(src)
      setDetailTaskId(null)
      setLightboxImageId(null)
      setMaskEditorImageId(null)
      showToast('已加入参考图', 'success')
    } catch (err) {
      console.error(err)
      showToast(`加入参考图失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const task = menuInfo.imageId ? useStore.getState().tasks.find(t => t.outputImages?.includes(menuInfo.imageId!)) : undefined
  const canvasNode = task ? useStore.getState().canvasNodes.find(n => n.taskId === task.id) : undefined
  const showSendToCanvas = appMode !== 'canvas'
  const showCanvasItems = appMode === 'canvas'

  let additionalCount = 0
  if (showSendToCanvas) additionalCount += 1
  if (showCanvasItems) additionalCount += 3

  // 保证菜单在视口内
  let left = menuInfo.x
  let top = menuInfo.y
  const MENU_WIDTH = 120
  const showDownloadAll = menuInfo.outputImageIds.length > 1
  const menuItemCount = (menuInfo.canCopyImage ? 1 : 0) + 1 + (showDownloadAll ? 1 : 0) + 1 + additionalCount
  const hasDivider = additionalCount > 0
  const MENU_HEIGHT = menuItemCount * 32 + (hasDivider ? 8 : 0) + 32

  if (left + MENU_WIDTH > window.innerWidth) {
    left -= MENU_WIDTH
  }
  if (top + MENU_HEIGHT > window.innerHeight) {
    top -= MENU_HEIGHT
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-100 dark:border-gray-700 py-1 w-[120px] overflow-hidden animate-fade-in"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menuInfo.canCopyImage && (
        <button
          onClick={handleCopy}
          className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
        >
          <CopyIcon className="w-4 h-4 flex-shrink-0" />
          复制
        </button>
      )}
      <button
        onClick={handleDownload}
        className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
      >
        <DownloadIcon className="w-4 h-4 flex-shrink-0" />
        下载
      </button>
      {showDownloadAll && (
        <button
          onClick={handleDownloadAll}
          className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
        >
          <DownloadIcon className="w-4 h-4 flex-shrink-0" />
          下载全部
        </button>
      )}
      <button
        onClick={handleEdit}
        className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
      >
        <EditIcon className="w-4 h-4 flex-shrink-0" />
        编辑
      </button>
      {hasDivider && <div className="h-px bg-gray-100 dark:bg-gray-700 my-1 mx-2" />}
      {showSendToCanvas && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setMenuInfo(null)
            useStore.getState().setAppMode('canvas')
            if (task?.id) {
              // @ts-ignore
              useStore.getState().importTasksToCanvas([task.id])
            }
          }}
          className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
        >
          <ExportIcon className="w-4 h-4 flex-shrink-0" />
          发送到画布
        </button>
      )}
      {showCanvasItems && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setMenuInfo(null)
              if (task?.id) {
                const nodeId = useStore.getState().canvasNodes.find(n => n.taskId === task.id)?.id
                // @ts-ignore
                if (nodeId) useStore.getState().bringCanvasNodeToFront(nodeId)
              }
            }}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
          >
            <ArrowDownIcon className="w-4 h-4 flex-shrink-0 rotate-180" />
            置于顶层
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setMenuInfo(null)
              if (task?.id) {
                const node = useStore.getState().canvasNodes.find(n => n.taskId === task.id)
                // @ts-ignore
                if (node) useStore.getState().updateCanvasNode(node.id, { locked: !node.locked })
              }
            }}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
          >
            <LinkIcon className="w-4 h-4 flex-shrink-0" />
            {canvasNode?.locked ? '解锁位置' : '锁定位置'}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setMenuInfo(null)
              if (task?.id) {
                const nodeIds = useStore.getState().canvasNodes.filter(n => n.taskId === task.id).map(n => n.id)
                // @ts-ignore
                useStore.getState().removeCanvasNodes(nodeIds)
              }
            }}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
          >
            <TrashIcon className="w-4 h-4 flex-shrink-0" />
            从画布移除
          </button>
        </>
      )}
    </div>
  )
}

function isEmbeddedPage() {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}
