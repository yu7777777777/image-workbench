import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAgentTextBuffer } from './agentTextBuffer'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('merges a burst of 100 deltas into one update without losing text', () => {
  const publish = vi.fn()
  const buffer = createAgentTextBuffer(publish)
  for (let i = 0; i < 100; i++) buffer.append('chat', 'reply', String(i))
  expect(publish).not.toHaveBeenCalled()
  vi.advanceTimersByTime(50)
  expect(publish).toHaveBeenCalledExactlyOnceWith('chat', 'reply', Array.from({ length: 100 }, (_, i) => String(i)).join(''))
})

it('keeps publishing during continuous output instead of waiting for silence', () => {
  const publish = vi.fn()
  const buffer = createAgentTextBuffer(publish)
  for (let i = 0; i < 20; i++) {
    buffer.append('chat', 'reply', '字')
    vi.advanceTimersByTime(10)
  }
  expect(publish).toHaveBeenCalledTimes(4)
  expect(publish.mock.calls.map((call) => call[2]).join('')).toBe('字'.repeat(20))
})

it('flushes the last text immediately on stop or completion, without a late duplicate', () => {
  const publish = vi.fn()
  const buffer = createAgentTextBuffer(publish)
  buffer.append('chat', 'reply', '最后一段')
  buffer.flush('chat')
  vi.advanceTimersByTime(100)
  expect(publish).toHaveBeenCalledExactlyOnceWith('chat', 'reply', '最后一段')
})

it('keeps simultaneous conversations and assistant messages separate', () => {
  const publish = vi.fn()
  const buffer = createAgentTextBuffer(publish)
  buffer.append('a', 'reply', '甲')
  buffer.append('a', 'other', '乙')
  buffer.append('b', 'reply', '丙')
  buffer.flush('a', 'reply')
  expect(publish).toHaveBeenCalledExactlyOnceWith('a', 'reply', '甲')
  vi.advanceTimersByTime(50)
  expect(publish.mock.calls).toEqual([['a', 'reply', '甲'], ['a', 'other', '乙'], ['b', 'reply', '丙']])
  buffer.append('a', 'reply', '切到后台')
  buffer.append('b', 'reply', '一并保存')
  buffer.flush()
  expect(publish.mock.calls.slice(-2)).toEqual([['a', 'reply', '切到后台'], ['b', 'reply', '一并保存']])
  vi.advanceTimersByTime(100)
  expect(publish).toHaveBeenCalledTimes(5)
})
