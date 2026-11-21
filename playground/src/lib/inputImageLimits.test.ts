import { describe, expect, it } from 'vitest'
import { DEFAULT_INPUT_IMAGE_LIMIT, getInputImageLimit, getInputImageLimitError, getInputImageLimitHint } from './inputImageLimits'

describe('inputImageLimits', () => {
  it('uses the unified application limit', () => {
    expect(getInputImageLimit()).toBe(DEFAULT_INPUT_IMAGE_LIMIT)
    expect(DEFAULT_INPUT_IMAGE_LIMIT).toBe(16)
  })

  it('builds the submission error from the limit', () => {
    expect(getInputImageLimitError(16)).toContain('16')
    expect(getInputImageLimitError(16)).toContain('参考图数量超过上限')
  })

  it('builds the over-limit hint from the limit', () => {
    expect(getInputImageLimitHint(16)).toContain('16 张参考图上限')
  })
})
