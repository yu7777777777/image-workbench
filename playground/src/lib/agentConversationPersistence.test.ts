import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentConversation } from '../types'
import { createAgentConversationPersistence } from './agentConversationPersistence'

const conversation = (id: string, title = id): AgentConversation => ({
  id, title, createdAt: 1, updatedAt: 1, activeRoundId: null, rounds: [], messages: [],
})
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('coalesces 100 updates and writes only the changed conversation', async () => {
  const history = Array.from({ length: 200 }, (_, i) => conversation(String(i)))
  let snapshot = history
  const save = vi.fn(async () => {})
  const persistence = createAgentConversationPersistence(() => snapshot, save)
  await persistence.flush()
  save.mockClear()
  for (let i = 0; i < 100; i++) {
    snapshot = [{ ...history[0], title: String(i) }, ...history.slice(1)]
    persistence.schedule()
  }
  await vi.advanceTimersByTimeAsync(500)
  expect(save).toHaveBeenCalledExactlyOnceWith([snapshot[0]], [])
})

it('saves during a continuous stream without postponing the deadline', async () => {
  let snapshot = [conversation('chat')]
  const save = vi.fn(async () => {})
  const persistence = createAgentConversationPersistence(() => snapshot, save)
  for (let i = 0; i < 20; i++) {
    snapshot = [conversation('chat', String(i))]
    persistence.schedule()
    await vi.advanceTimersByTimeAsync(100)
  }
  expect(save).toHaveBeenCalledTimes(4)
  expect(save).toHaveBeenLastCalledWith(snapshot, [])
})

it('serializes slow writes and removes a conversation deleted while an old write is pending', async () => {
  let snapshot = [conversation('deleted'), conversation('kept')]
  let resolve!: () => void
  const save = vi.fn(() => new Promise<void>((done) => { resolve = done }))
  const persistence = createAgentConversationPersistence(() => snapshot, save)
  const first = persistence.flush()
  snapshot = [snapshot[1]]
  persistence.schedule()
  await vi.advanceTimersByTimeAsync(1000)
  expect(save).toHaveBeenCalledTimes(1)
  resolve()
  await first
  save.mockImplementation(async () => {})
  await vi.advanceTimersByTimeAsync(500)
  expect(save).toHaveBeenLastCalledWith([], ['deleted'])
})

it('flushes the latest snapshot after an in-flight write without overwriting it with stale data', async () => {
  let snapshot = [conversation('chat', '旧')]
  let resolve!: () => void
  const save = vi.fn(() => new Promise<void>((done) => { resolve = done }))
  const persistence = createAgentConversationPersistence(() => snapshot, save)
  const first = persistence.flush()
  snapshot = [conversation('chat', '新')]
  const final = persistence.flush()
  save.mockImplementation(async () => {})
  resolve()
  await Promise.all([first, final])
  expect(save).toHaveBeenCalledTimes(2)
  expect(save).toHaveBeenLastCalledWith(snapshot, [])
  await vi.advanceTimersByTimeAsync(1000)
  expect(save).toHaveBeenCalledTimes(2)
})

it('retains dirty data when a transaction fails so a subsequent flush retries it', async () => {
  const snapshot = [conversation('chat')]
  const save = vi.fn(async () => {}).mockRejectedValueOnce(new Error('quota'))
  const persistence = createAgentConversationPersistence(() => snapshot, save)
  await expect(persistence.flush()).rejects.toThrow('quota')
  await persistence.flush()
  expect(save).toHaveBeenCalledTimes(2)
  expect(save).toHaveBeenLastCalledWith(snapshot, [])
})

it('does not rewrite unchanged data when unrelated UI events schedule a save', async () => {
  const snapshot = [conversation('chat')]
  const save = vi.fn(async () => {})
  const persistence = createAgentConversationPersistence(() => snapshot, save)
  await persistence.flush()
  persistence.schedule()
  await vi.advanceTimersByTimeAsync(500)
  expect(save).toHaveBeenCalledTimes(1)
})
