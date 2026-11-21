import type { ApiProvider, TaskParams, TaskRecord } from '../types'

type TaskLifecyclePatch = Pick<TaskRecord, 'status' | 'error' | 'finishedAt' | 'elapsed'>
type ActualParams = Partial<TaskParams>
type ImageSize = { width?: number; height?: number }

export function createTaskDonePatch(task: Pick<TaskRecord, 'createdAt'>, now: number): TaskLifecyclePatch {
  return {
    status: 'done',
    error: null,
    finishedAt: now,
    elapsed: now - task.createdAt,
  }
}

export function createTaskErrorPatch(task: Pick<TaskRecord, 'createdAt'>, error: string, now: number): TaskLifecyclePatch {
  return {
    status: 'error',
    error,
    finishedAt: now,
    elapsed: now - task.createdAt,
  }
}

export function markInterruptedOpenAIRunningTasks(tasks: TaskRecord[], now: number) {
  const interruptedTasks: TaskRecord[] = []
  const updatedTasks = tasks.map((task) => {
    const isOpenAITask = (task.apiProvider ?? 'openai') !== 'fal'
    if (task.status !== 'running' || !isOpenAITask || task.customTaskId) return task

    const updated: TaskRecord = {
      ...task,
      ...createTaskErrorPatch(task, '请求中断', now),
      falRecoverable: false,
      elapsed: Math.max(0, now - task.createdAt),
    }
    interruptedTasks.push(updated)
    return updated
  })

  return { tasks: updatedTasks, interruptedTasks }
}

export function hasActualParams(params: ActualParams | undefined): params is ActualParams {
  return Boolean(params && Object.keys(params).length > 0)
}

export function firstActualParams(paramsList: Array<ActualParams | undefined> | undefined): ActualParams | undefined {
  return paramsList?.find(hasActualParams)
}

export function mapActualParamsByImage(outputIds: string[], paramsList: Array<ActualParams | undefined> | undefined) {
  const mapped = paramsList?.reduce<Record<string, ActualParams>>((acc, params, index) => {
    const imgId = outputIds[index]
    if (imgId && hasActualParams(params)) acc[imgId] = params
    return acc
  }, {})
  return mapped && Object.keys(mapped).length > 0 ? mapped : undefined
}

export function hasActualSizeParam(params: ActualParams | undefined) {
  return Boolean(params?.size)
}

export function addImageSizeParam(params: ActualParams | undefined, size: ImageSize | undefined): ActualParams | undefined {
  if (hasActualSizeParam(params) || !size?.width || !size.height) return params
  return { ...(params ?? {}), size: `${size.width}x${size.height}` }
}

export function deriveAgentImageActualParams(params: ActualParams | undefined, size: ImageSize | undefined): ActualParams {
  return {
    ...(addImageSizeParam(hasActualParams(params) ? params : undefined, size) ?? {}),
    n: 1,
  }
}

export function deriveGalleryActualParams(
  provider: ApiProvider,
  isAsyncCustomTask: boolean,
  resultParams: ActualParams | undefined,
  paramsList: Array<ActualParams | undefined> | undefined,
  outputCount: number,
): ActualParams | undefined {
  if (provider === 'fal' || isAsyncCustomTask) return firstActualParams(paramsList)
  const firstParams = firstActualParams(paramsList)
  return {
    ...resultParams,
    size: resultParams?.size ?? firstParams?.size,
    n: outputCount,
  }
}

export function mapRevisedPromptsByImage(outputIds: string[], revisedPrompts: Array<string | undefined> | undefined) {
  const mapped = revisedPrompts?.reduce<Record<string, string>>((acc, prompt, index) => {
    const imgId = outputIds[index]
    if (imgId && prompt?.trim()) acc[imgId] = prompt
    return acc
  }, {})
  return mapped && Object.keys(mapped).length > 0 ? mapped : undefined
}

// ===== 输出槽位（成功图片与失败记录按请求序号对齐） =====

/** 任务输出槽位 */
export interface TaskOutputSlot {
  /** 从 0 开始的请求序号 */
  requestIndex: number
  /** 在 outputImages 中的下标，失败槽位为 -1 */
  outputImageIndex: number
  /** 成功图片的 image store id，失败槽位为空串 */
  imageId: string
  /** 失败原因，成功槽位为空串 */
  error: string
}

/**
 * 把任务的 outputImages 与 outputErrors 合成为按请求序号对齐的槽位数组，
 * 从未填充的空白槽位（既无图片也无失败记录）会被过滤。
 */
export function getTaskOutputSlots(task: TaskRecord): TaskOutputSlot[] {
  const outputErrors = task.outputErrors ?? []
  if (outputErrors.length === 0) {
    return task.outputImages.map((imageId, outputImageIndex) => ({
      requestIndex: outputImageIndex,
      outputImageIndex,
      imageId,
      error: '',
    }))
  }

  const errorsByIndex = new Map(outputErrors.map((item) => [item.requestIndex, item.error]))
  const requestedCount = Math.max(
    task.params.n,
    task.outputImages.length + outputErrors.length,
    ...Array.from(errorsByIndex.keys(), (index) => index + 1),
  )
  let outputImageIndex = 0
  return Array.from({ length: requestedCount }, (_, requestIndex) => {
    const error = errorsByIndex.get(requestIndex)
    if (error) return { requestIndex, outputImageIndex: -1, imageId: '', error }
    const imageId = task.outputImages[outputImageIndex] ?? ''
    const slot = { requestIndex, outputImageIndex, imageId, error: '' }
    outputImageIndex += 1
    return slot
  }).filter((slot) => slot.imageId || slot.error)
}
