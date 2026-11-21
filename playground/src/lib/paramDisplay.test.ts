// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import type { TaskRecord } from '../types'
import { getParamCompareRows, getParamCompareRowsForImage } from './paramDisplay'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

describe('getParamCompareRows', () => {
  it('returns mismatch rows when real pixels deviate from the request', () => {
    const rows = getParamCompareRows(
      task({ params: { ...DEFAULT_PARAMS, size: '1536x1024' } }),
      { size: '1672x940', aspect_ratio: '16:9', resolution: '1K' },
    )
    expect(rows.find((row) => row.key === 'aspect_ratio')).toMatchObject({
      requested: '3:2',
      actual: '16:9',
      isMismatch: true,
    })
    expect(rows.find((row) => row.key === 'resolution')).toMatchObject({
      requested: '1K',
      actual: '1K',
      isMismatch: false,
    })
    expect(rows.find((row) => row.key === 'size')).toMatchObject({
      requested: '1536x1024',
      actual: '1672x940',
      isMismatch: true,
    })
  })

  it('does not flag within-tolerance pixel rounding on ratio and resolution rows', () => {
    const rows = getParamCompareRows(
      task({ params: { ...DEFAULT_PARAMS, size: '1254x1254' } }),
      { size: '1256x1232', aspect_ratio: '1:1', resolution: '1K' },
    )
    // 尺寸行对比的是精确像素（1254x1254 vs 1256x1232 本就不相等），
    // 比例与分辨率行在容差内不应误报。
    const derivedRows = rows.filter((row) => row.key !== 'size')
    expect(derivedRows).toHaveLength(2)
    expect(derivedRows.every((row) => !row.isMismatch)).toBe(true)
  })

  it('normalizes × and x when comparing sizes', () => {
    const rows = getParamCompareRows(
      task({ params: { ...DEFAULT_PARAMS, size: '1254x1254' } }),
      { size: '1254×1254', aspect_ratio: '1:1', resolution: '1K' },
    )
    expect(rows.find((row) => row.key === 'size')?.isMismatch).toBe(false)
  })

  it('omits rows when the requested size is auto', () => {
    const rows = getParamCompareRows(
      task(),
      { size: '1254x1254', aspect_ratio: '1:1', resolution: '1K' },
    )
    expect(rows).toEqual([])
  })

  it('derives rows from real pixel dimensions via getParamCompareRowsForImage', () => {
    const rows = getParamCompareRowsForImage(
      task({ params: { ...DEFAULT_PARAMS, size: '1536x1024' } }),
      1672,
      940,
    )
    expect(rows.find((row) => row.key === 'aspect_ratio')).toMatchObject({
      requested: '3:2',
      actual: '16:9',
      isMismatch: true,
    })
    expect(rows.find((row) => row.key === 'size')?.actual).toBe('1672x940')
  })
})
