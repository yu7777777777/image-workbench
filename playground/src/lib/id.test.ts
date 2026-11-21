import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalId } from './id'

describe('createLocalId', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses randomUUID when the browser exposes it', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-from-browser' })
    expect(createLocalId('canvas')).toBe('uuid-from-browser')
  })

  it('falls back on an ordinary HTTP origin without randomUUID', () => {
    vi.stubGlobal('crypto', {})
    const id = createLocalId('canvas')
    expect(id.startsWith('canvas-')).toBe(true)
    expect(id.split('-').length).toBeGreaterThanOrEqual(4)
  })
})
