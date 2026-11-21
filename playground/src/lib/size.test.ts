import { describe, expect, it } from 'vitest'
import { calculateImageSize, normalizeCodexCliImageSize, prependCodexCliSizePrompt, stripInjectedCodexCliSizePrompt } from './size'

describe('calculateImageSize', () => {
  // 上游按约 157 万像素原生生成：方形固定 1254×1254，其余比例按预算适配。
  it('uses the native square resolution for 1:1', () => {
    expect(calculateImageSize('1K', '1:1')).toBe('1254x1254')
  })

  it('uses native landscape and portrait presets', () => {
    expect(calculateImageSize('1K', '3:2')).toBe('1536x1024')
    expect(calculateImageSize('1K', '2:3')).toBe('1024x1536')
    expect(calculateImageSize('1K', '16:9')).toBe('1672x940')
    expect(calculateImageSize('1K', '9:16')).toBe('940x1672')
  })

  it('falls back to budget-based sizing for custom ratios', () => {
    const size = calculateImageSize('1K', '5:4')
    expect(size).not.toBeNull()
    const [width, height] = String(size).split('x').map(Number)
    // 16 的倍数约束会让实际比例略有偏差，放宽到 1 位小数。
    expect(width / height).toBeCloseTo(1.25, 1)
    expect(width * height).toBeLessThanOrEqual(1_572_864)
  })
})

describe('Codex CLI size compatibility', () => {
  it('normalizes custom sizes to the 1K pixel budget', () => {
    expect(normalizeCodexCliImageSize('2048x2048')).toBe('1254x1254')
    expect(normalizeCodexCliImageSize('2048x1536')).toBe('1448x1086')
    expect(normalizeCodexCliImageSize('1536x1024')).toBe('1536x1024')
  })

  it('preserves non-preset ratios approximately and clamps excessive ratios', () => {
    expect(normalizeCodexCliImageSize('2500x2000')).toBe(calculateImageSize('1K', '5:4'))
    const [width, height] = normalizeCodexCliImageSize('4000x1000').split('x').map(Number)
    expect(width / height).toBeCloseTo(3, 2)
    expect(width * height).toBeLessThanOrEqual(1_572_864)
  })

  it('prepends a concise resolution hint only for explicit sizes', () => {
    expect(prependCodexCliSizePrompt('Draw a cat.\n', '1024x1024')).toBe('Generate at 1024x1024 resolution. Draw a cat.\n')
    expect(prependCodexCliSizePrompt('Generate at 1024x1024 resolution. Draw a cat.', '1024x1024')).toBe('Generate at 1024x1024 resolution. Draw a cat.')
    expect(prependCodexCliSizePrompt('Draw a cat.', 'auto')).toBe('Draw a cat.')
  })

  it('strips only the matching injected resolution hint', () => {
    expect(stripInjectedCodexCliSizePrompt('Generate at 1024x1024 resolution. Draw a cat.', 'Draw a cat.', '1024x1024')).toBe('Draw a cat.')
    expect(stripInjectedCodexCliSizePrompt('Generate at 2048x2048 resolution. Draw a cat.', 'Draw a cat.', '1024x1024')).toBe('Generate at 2048x2048 resolution. Draw a cat.')
    expect(stripInjectedCodexCliSizePrompt('Generate at 1024x1024 resolution. Draw a cat.', 'Generate at 1024x1024 resolution. Draw a cat.', '1024x1024')).toBe('Generate at 1024x1024 resolution. Draw a cat.')
    expect(stripInjectedCodexCliSizePrompt('Generate at 1024x1024 resolution. Draw a cat.', 'Draw a cat.', 'auto')).toBe('Generate at 1024x1024 resolution. Draw a cat.')
  })
})
