import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import {
  MASONRY_MAX_ASPECT_RATIO,
  MASONRY_MIN_ASPECT_RATIO,
  MASONRY_NON_DONE_MAX_ASPECT_RATIO,
  MASONRY_NON_DONE_MIN_ASPECT_RATIO,
  computeMasonryLayout,
  getVisibleMasonryItems,
  parseSizeAspectRatio,
  resolveTaskMasonryAspect,
} from './galleryMasonry'

function createTask(overrides: Partial<TaskRecord> & { id: string }): TaskRecord {
  return {
    prompt: 'test',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages: [`img-${overrides.id}`],
    status: 'done',
    error: null,
    createdAt: Date.now(),
    finishedAt: Date.now(),
    elapsed: 1000,
    ...overrides,
  }
}

describe('galleryMasonry', () => {
  it('parses pixel size and ratio strings into aspect ratios', () => {
    expect(parseSizeAspectRatio('1024x1536')).toBeCloseTo(2 / 3)
    expect(parseSizeAspectRatio('1672×940')).toBeCloseTo(1672 / 940)
    expect(parseSizeAspectRatio('9:16')).toBeCloseTo(9 / 16)
    expect(parseSizeAspectRatio('auto')).toBeNull()
    expect(parseSizeAspectRatio('')).toBeNull()
    expect(parseSizeAspectRatio('invalid')).toBeNull()
  })

  it('resolves aspect ratio with priority: measured > actualParamsByImage > actualParams > params > fallback', () => {
    const task = createTask({
      id: 't1',
      outputImages: ['img-1'],
      params: { ...DEFAULT_PARAMS, size: '1024x1024' },
      actualParams: { size: '1672x940' },
      actualParamsByImage: { 'img-1': { size: '1024x1536' } },
    })

    expect(resolveTaskMasonryAspect(task, { width: 800, height: 1200 }).aspectRatio).toBeCloseTo(2 / 3)
    expect(resolveTaskMasonryAspect(task, { width: 1200, height: 600 }).aspectRatio).toBeCloseTo(2)
    expect(resolveTaskMasonryAspect(task).aspectRatio).toBeCloseTo(2 / 3)

    const withoutPerImage = createTask({
      id: 't2',
      params: { ...DEFAULT_PARAMS, size: '1024x1024' },
      actualParams: { size: '1672x940' },
    })
    expect(resolveTaskMasonryAspect(withoutPerImage).aspectRatio).toBeCloseTo(1672 / 940)

    const autoTask = createTask({
      id: 't3',
      params: { ...DEFAULT_PARAMS, size: 'auto' },
    })
    expect(resolveTaskMasonryAspect(autoTask).aspectRatio).toBe(1)
  })

  it('clamps extreme tall and ultra-wide images while leaving common ratios uncropped', () => {
    const portrait23 = createTask({ id: 'p23', params: { ...DEFAULT_PARAMS, size: '1024x1536' } })
    const portrait916 = createTask({ id: 'p916', params: { ...DEFAULT_PARAMS, size: '940x1672' } })
    const ultraTall = createTask({ id: 'tall', params: { ...DEFAULT_PARAMS, size: '800x3200' } })
    const ultraWide = createTask({ id: 'wide', params: { ...DEFAULT_PARAMS, size: '3000x800' } })

    const r23 = resolveTaskMasonryAspect(portrait23)
    expect(r23.isHeightCapped).toBe(false)
    expect(r23.aspectRatio).toBeCloseTo(2 / 3)

    const r916 = resolveTaskMasonryAspect(portrait916)
    expect(r916.isHeightCapped).toBe(false)
    expect(r916.aspectRatio).toBeCloseTo(940 / 1672)

    const rTall = resolveTaskMasonryAspect(ultraTall)
    expect(rTall.isHeightCapped).toBe(true)
    expect(rTall.isWidthCapped).toBe(false)
    expect(rTall.aspectRatio).toBeCloseTo(MASONRY_MIN_ASPECT_RATIO)

    const rWide = resolveTaskMasonryAspect(ultraWide)
    expect(rWide.isWidthCapped).toBe(true)
    expect(rWide.isHeightCapped).toBe(false)
    expect(rWide.aspectRatio).toBeCloseTo(MASONRY_MAX_ASPECT_RATIO)
  })

  it('protects running and failed cards from extreme proportions', () => {
    const failedWide = createTask({
      id: 'err-wide',
      status: 'error',
      outputImages: [],
      params: { ...DEFAULT_PARAMS, size: '21:9' },
    })
    const runningTall = createTask({
      id: 'run-tall',
      status: 'running',
      outputImages: [],
      params: { ...DEFAULT_PARAMS, size: '9:20' },
    })

    const rWide = resolveTaskMasonryAspect(failedWide)
    expect(rWide.aspectRatio).toBe(MASONRY_NON_DONE_MAX_ASPECT_RATIO)
    expect(rWide.isHeightCapped).toBe(false)

    const rTall = resolveTaskMasonryAspect(runningTall)
    expect(rTall.aspectRatio).toBe(MASONRY_NON_DONE_MIN_ASPECT_RATIO)
    expect(rTall.isHeightCapped).toBe(false)
  })

  it('places the first row strictly left-to-right and keeps chronological top order across mixed heights', () => {
    const tasks = [
      createTask({ id: 't0', params: { ...DEFAULT_PARAMS, size: '1024x1024' } }),
      createTask({ id: 't1', params: { ...DEFAULT_PARAMS, size: '1672x940' } }),
      createTask({ id: 't2', params: { ...DEFAULT_PARAMS, size: '1024x1536' } }),
      createTask({ id: 't3', params: { ...DEFAULT_PARAMS, size: '1024x1024' } }),
      createTask({ id: 't4', params: { ...DEFAULT_PARAMS, size: '1024x1536' } }),
      createTask({ id: 't5', params: { ...DEFAULT_PARAMS, size: '1024x1024' } }),
    ]

    const layout = computeMasonryLayout(tasks, {
      containerWidth: 624,
      columns: 3,
      gap: 12,
    })

    expect(layout.columnWidth).toBe(200)
    // 第一排严格按 0, 1, 2 从左到右
    expect(layout.items[0]).toMatchObject({ column: 0, left: 0, top: 0, height: 200 })
    expect(layout.items[1]).toMatchObject({ column: 1, left: 212, top: 0, height: 112 })
    expect(layout.items[2]).toMatchObject({ column: 2, left: 424, top: 0, height: 300 })

    // 第 4 张优先补到最矮的第 1 列（top=124），第 5 张补到次矮的第 0 列（top=212）
    expect(layout.items[3]).toMatchObject({ column: 1, top: 124 })
    expect(layout.items[4]).toMatchObject({ column: 0, top: 212 })
    expect(layout.items[5]).toMatchObject({ column: 2, top: 312 })

    // 纵向 top 严格保持时间单调递减/不倒挂
    for (let i = 1; i < layout.items.length; i++) {
      expect(layout.items[i].top).toBeGreaterThanOrEqual(layout.items[i - 1].top)
    }
  })

  it('uses leftmost column when column heights are within tie tolerance to preserve row order', () => {
    const tasks = [
      createTask({ id: 'a0', params: { ...DEFAULT_PARAMS, size: '1000x1010' } }),
      createTask({ id: 'a1', params: { ...DEFAULT_PARAMS, size: '1000x1000' } }),
      createTask({ id: 'a2', params: { ...DEFAULT_PARAMS, size: '1000x1000' } }),
      createTask({ id: 'a3', params: { ...DEFAULT_PARAMS, size: '1000x1000' } }),
    ]

    const layout = computeMasonryLayout(tasks, {
      containerWidth: 624,
      columns: 3,
      gap: 12,
    })

    // 第 0 列比第 1 列仅高 2px，在容差内应保持下一排从最左列开始
    expect(layout.items[3].column).toBe(0)
  })

  it('caps ultra-tall cards in layout height so no single column explodes', () => {
    const tasks = [
      createTask({ id: 'normal', params: { ...DEFAULT_PARAMS, size: '1000x1000' } }),
      createTask({ id: 'detail', params: { ...DEFAULT_PARAMS, size: '800x4000' } }),
    ]

    const layout = computeMasonryLayout(tasks, {
      containerWidth: 412,
      columns: 2,
      gap: 12,
    })

    expect(layout.columnWidth).toBe(200)
    expect(layout.items[1].isHeightCapped).toBe(true)
    expect(layout.items[1].height).toBe(Math.round(200 / MASONRY_MIN_ASPECT_RATIO))
    expect(layout.totalHeight).toBe(layout.items[1].height)
  })

  it('filters visible items cleanly for virtual scrolling', () => {
    const tasks = Array.from({ length: 100 }, (_, index) =>
      createTask({ id: `t-${index}`, params: { ...DEFAULT_PARAMS, size: '1000x1000' } }),
    )
    const layout = computeMasonryLayout(tasks, {
      containerWidth: 1048,
      columns: 5,
      gap: 12,
    })

    const visible = getVisibleMasonryItems(layout.items, 1000, 1800, 300)
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.length).toBeLessThan(layout.items.length)
    for (const item of visible) {
      expect(item.bottom).toBeGreaterThanOrEqual(700)
      expect(item.top).toBeLessThanOrEqual(2100)
    }
  })
})
