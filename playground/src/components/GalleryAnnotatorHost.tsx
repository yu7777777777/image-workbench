import { useEffect, useRef, useState } from 'react'
import { ImageAnnotatorModal } from './ImageAnnotatorModal'
import type { ImageAnnotatorResult } from './ImageAnnotatorModal'
import type { MaskDraft, TaskParams, TaskRecord } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { submitTask, useStore } from '../store'
import { putTask } from '../lib/db'
import { ensureImageCached } from '../lib/imageCache'

/** 标注宿主当前的打开状态（全局唯一，同一时间只会有一个标注弹窗）。 */
export interface GalleryAnnotatorState {
  imageId: string
  /** 发起标注的任务 id，用于在任务被后台刷新替换后仍能找回 API 配置 */
  taskId: string
}

let openGalleryAnnotatorRef: ((state: GalleryAnnotatorState | null) => void) | null = null

/**
 * 打开画廊标注弹窗。
 * 由画廊（DetailModal 等）调用，真正的渲染发生在与 DetailModal 平级的 GalleryAnnotatorHost 里，
 * 这样 DetailModal 因为 task 暂时消失而提前 return null 时，标注弹窗不会被连根卸载。
 * 返回 false 表示宿主当前未挂载（调用方可回退到本地渲染）。
 */
export function openGalleryAnnotator(state: GalleryAnnotatorState): boolean {
  if (!openGalleryAnnotatorRef) return false
  openGalleryAnnotatorRef(state)
  return true
}

/** 标注期间用作兜底的参数快照，避免任务消失时丢配置。 */
const EMPTY_TASK_PARAMS: TaskParams = { ...DEFAULT_PARAMS }

function makeTaskParamsSnapshot(task: TaskRecord | null | undefined): TaskParams {
  return { ...(task?.params ?? EMPTY_TASK_PARAMS) }
}

/**
 * 画廊标注宿主：负责渲染 ImageAnnotatorModal 并把「应用」结果落地。
 * 独立于 DetailModal 渲染，保证标注过程不受画廊任务列表刷新 / 详情弹窗卸载影响。
 */
export function GalleryAnnotatorHost() {
  const tasks = useStore((s) => s.tasks)
  const showToast = useStore((s) => s.showToast)
  const settings = useStore((s) => s.settings)
  const [annotatorState, setAnnotatorState] = useState<GalleryAnnotatorState | null>(null)
  /** 最后一次非 null 的任务快照：任务暂时不在 tasks 里时回退用它，避免配置丢失与 UI 闪烁 */
  const lastTaskRef = useRef<TaskRecord | null>(null)

  useEffect(() => {
    openGalleryAnnotatorRef = setAnnotatorState
    return () => {
      if (openGalleryAnnotatorRef === setAnnotatorState) openGalleryAnnotatorRef = null
    }
  }, [])

  const annotatorTaskId = annotatorState?.taskId ?? ''
  const liveTask = annotatorTaskId ? tasks.find((item) => item.id === annotatorTaskId) ?? null : null
  if (liveTask) lastTaskRef.current = liveTask

  const paramsSnapshotRef = useRef<TaskParams>(makeTaskParamsSnapshot(lastTaskRef.current))
  if (liveTask && annotatorState) paramsSnapshotRef.current = { ...liveTask.params }
  if (!annotatorState) return null

  /** 稳定版任务引用：优先用实时任务，其次用最后一帧快照 */
  const stableTask = (): TaskRecord | null =>
    (annotatorState.taskId
      ? useStore.getState().tasks.find((item) => item.id === annotatorState.taskId)
      : undefined) ?? lastTaskRef.current

  const makeAnnotatedPlaceholder = (result: ImageAnnotatorResult): TaskRecord => {
    const snapshot = lastTaskRef.current
    return {
      id: `annotator-${Date.now()}-${result.imageIds[0]}`,
      prompt: '图片标注',
      params: { ...(snapshot?.params ?? paramsSnapshotRef.current), n: 1 },
      apiProvider: snapshot?.apiProvider,
      apiProfileId: snapshot?.apiProfileId,
      apiProfileName: snapshot?.apiProfileName,
      apiMode: snapshot?.apiMode,
      apiModel: snapshot?.apiModel,
      inputImageIds: [result.imageIds[0]],
      outputImages: [result.imageIds[0]],
      status: 'done',
      error: null,
      createdAt: Date.now(),
      finishedAt: Date.now(),
      elapsed: null,
    }
  }

  const addAnnotatedImagesAsTasks = (result: ImageAnnotatorResult) => {
    const annotatedTask = useStore.getState().tasks.find((item) =>
      item.outputImages.some((imageId) => result.imageIds.includes(imageId)),
    ) ?? makeAnnotatedPlaceholder(result)
    if (!useStore.getState().tasks.some((item) => item.id === annotatedTask.id)) {
      useStore.getState().setTasks([annotatedTask, ...useStore.getState().tasks])
      void putTask(annotatedTask)
    }
    useStore.getState().setDetailTaskId(annotatedTask.id)
    showToast('标注结果已保存为画廊中的新图片', 'success')
  }

  /**
   * 画廊标注「应用」的落地方式：
   * - 评论锚点：直接用当前图 + 锚点评论发起一次编辑生成（store 已支持 comments 透传，后端允许纯评论无提示词）；
   * - 遮罩：复刻 MaskEditorModal，把当前图设为输入图并写入 maskDraft，用户点「生成」即带上遮罩；
   * - 裁剪 / 缩放 / 宫格切分：产物本身就是新图片，按新任务落地。
   */
  const handleApply = async (result: ImageAnnotatorResult) => {
    try {
      const targetImageId = result.imageIds?.[0] ?? ''
      setAnnotatorState(null)
      if (!targetImageId) return

      if (result.comments?.length) {
        const dataUrl = await ensureImageCached(targetImageId)
        if (!dataUrl) {
          showToast('原图已不存在，无法用评论锚点发起编辑', 'error')
          return
        }
        const currentTask = stableTask()
        // 任务已彻底消失时退回快照参数与当前激活配置，保证仍能发起编辑
        const params: TaskParams = { ...(currentTask?.params ?? paramsSnapshotRef.current) }
        // 沿用当前任务的 API 配置；该配置已被删除时退回当前激活配置（传不存在的 profileId 会直接被 submitTask 拒绝）
        const taskProfileId = currentTask?.apiProfileId
          && settings.profiles.some((profile) => profile.id === currentTask.apiProfileId)
          ? currentTask.apiProfileId
          : undefined
        const taskId = await submitTask({
          input: {
            prompt: '',
            inputImages: [{ id: targetImageId, dataUrl }],
            params,
            ...(taskProfileId ? { profileId: taskProfileId } : {}),
            // 锚点坐标以「当前这张图」为 0 号输入图，重排 image_index 避免多图时错位
            comments: result.comments.map((comment) => ({ ...comment, image_index: 0 })),
          },
        })
        if (taskId) {
          useStore.getState().setDetailTaskId(null)
          showToast(`已用评论锚点发起编辑（${result.comments.length} 条）`, 'success')
        }
        return
      }

      if (result.maskDataUrl) {
        const dataUrl = await ensureImageCached(targetImageId)
        if (!dataUrl) {
          showToast('原图已不存在，无法保存遮罩', 'error')
          return
        }
        const state = useStore.getState()
        // 与 MaskEditorModal 一致：当前图成为唯一输入图，并写入遮罩草稿，之后点「生成」即带上遮罩
        state.setInputImages([{ id: targetImageId, dataUrl }])
        const maskDraft: MaskDraft = { targetImageId, maskDataUrl: result.maskDataUrl, updatedAt: Date.now() }
        state.setMaskDraft(maskDraft)
        useStore.getState().setDetailTaskId(null)
        showToast('遮罩已保存，回到画廊点「生成」即可按遮罩编辑', 'success')
        return
      }

      addAnnotatedImagesAsTasks(result)
    } catch (err) {
      console.error('画廊标注应用失败', err)
      showToast(`标注结果应用失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  return (
    <ImageAnnotatorModal
      imageId={annotatorState.imageId}
      onClose={() => setAnnotatorState(null)}
      onApply={handleApply}
    />
  )
}

export default GalleryAnnotatorHost

