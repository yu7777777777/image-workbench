import { useEffect, useRef, useState } from 'react'
import type { TaskParams, TaskRecord } from '../types'
import { getImageActualParams, getImageRequestedParams, type ImageActualParams } from './imageActualParams'
import ViewportTooltip from '../components/ViewportTooltip'

type ParamKey = keyof TaskParams

interface ParamValueProps {
  task: TaskRecord
  paramKey: ParamKey
  className?: string
  actualParams?: Partial<TaskParams>
}

interface ActualValueBadgeProps {
  value: string
  className?: string
  variant?: 'highlight' | 'normal'
  tooltip?: string
}

export function ActualValueBadge({ value, className = '', variant = 'highlight', tooltip = 'API 实际响应值' }: ActualValueBadgeProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const touchTimerRef = useRef<number | null>(null)
  const colorClass = variant === 'normal'
    ? 'bg-gray-100 text-gray-500 dark:bg-white/[0.04] dark:text-gray-400'
    : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300'

  useEffect(() => () => {
    if (touchTimerRef.current != null) window.clearTimeout(touchTimerRef.current)
  }, [])

  const clearTouchTimer = () => {
    if (touchTimerRef.current != null) {
      window.clearTimeout(touchTimerRef.current)
      touchTimerRef.current = null
    }
  }

  return (
    <span
      className={`relative inline-flex cursor-help ${colorClass} ${className}`}
      role="button"
      tabIndex={0}
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
      onClick={() => setTooltipVisible(true)}
      onTouchStart={() => {
        clearTouchTimer()
        touchTimerRef.current = window.setTimeout(() => {
          setTooltipVisible(true)
          touchTimerRef.current = null
        }, 450)
      }}
      onTouchEnd={clearTouchTimer}
      onTouchCancel={clearTouchTimer}
    >
      {value}
      <ViewportTooltip visible={tooltipVisible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

export function getParamDisplay(task: TaskRecord, paramKey: ParamKey, actualParams = task.actualParams) {
  const requestedValue = task.sourceMode === 'agent' && paramKey === 'n'
    ? 'auto'
    : task.params[paramKey]
  const actualValue = actualParams?.[paramKey]
  const hasActualValue = actualValue !== undefined && actualValue !== null
  const displayValue = hasActualValue ? actualValue : requestedValue
  const isMismatch =
    hasActualValue &&
    requestedValue !== 'auto' &&
    String(actualValue) !== String(requestedValue)

  return {
    displayValue: String(displayValue),
    isMismatch,
    requestedValue: String(requestedValue),
    isAutoResolved: hasActualValue && requestedValue === 'auto' && String(actualValue) !== String(requestedValue),
  }
}

export function DetailParamValue({ task, paramKey, className = '', actualParams }: ParamValueProps) {
  const { displayValue, isMismatch, requestedValue, isAutoResolved } = getParamDisplay(task, paramKey, actualParams)

  if (!isMismatch) {
    if (isAutoResolved) {
      return (
        <span className={`inline-flex items-center gap-1 ${className}`}>
          <span className="text-gray-700 dark:text-gray-300">{requestedValue}</span>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <ActualValueBadge value={displayValue} variant="normal" className="rounded px-1 py-0.5" />
        </span>
      )
    }
    return <span className={`text-gray-700 dark:text-gray-300 ${className}`}>{displayValue}</span>
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="text-gray-700 dark:text-gray-300">{requestedValue}</span>
      <span className="text-gray-300 dark:text-gray-600">|</span>
      <ActualValueBadge value={displayValue} className="rounded px-1 py-0.5" />
    </span>
  )
}

// ===== 基于图片真实像素的"请求 vs 实际"对比行（比例 / 分辨率） =====

export type ParamCompareKey = 'aspect_ratio' | 'resolution' | 'size'

export interface ParamCompareRow {
  key: ParamCompareKey
  label: string
  requested: string
  actual: string
  isMismatch: boolean
}

/**
 * 以图片真实像素为实际值，生成 比例 / 分辨率 / 尺寸 的对比行。
 * 请求值为 auto 或无法派生时该行不输出。
 */
export function getParamCompareRows(task: TaskRecord, actual: ImageActualParams): ParamCompareRow[] {
  const requested = getImageRequestedParams(task)
  const rows: ParamCompareRow[] = []
  const pushRow = (key: ParamCompareKey, label: string, requestedValue: string | undefined, actualValue: string | undefined) => {
    if (!requestedValue || !actualValue) return
    const requestedText = key === 'size' ? requestedValue.replace(/×/g, 'x') : requestedValue
    const actualText = key === 'size' ? actualValue.replace(/×/g, 'x') : actualValue
    rows.push({ key, label, requested: requestedText, actual: actualText, isMismatch: requestedText !== actualText })
  }
  pushRow('aspect_ratio', '比例', requested.aspect_ratio, actual.aspect_ratio)
  pushRow('resolution', '分辨率', requested.resolution, actual.resolution)
  pushRow('size', '尺寸', requested.size !== 'auto' ? requested.size : undefined, actual.size)
  return rows
}

/** 实际参数与请求参数不一致的行 key 集合，便于调用方快速判断。 */
export function getMismatchedParamKeys(rows: ParamCompareRow[]): Set<ParamCompareKey> {
  return new Set(rows.filter((row) => row.isMismatch).map((row) => row.key))
}

/** 便捷组合：由任务与真实像素直接得到对比行。 */
export function getParamCompareRowsForImage(task: TaskRecord, width: number, height: number): ParamCompareRow[] {
  return getParamCompareRows(task, getImageActualParams(task, width, height))
}
