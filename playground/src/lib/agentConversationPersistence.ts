import type { AgentConversation } from '../types'

// 只对变化的会话做增量写入；串行提交，防止旧快照覆盖新回复或复活已删除会话。
export function createAgentConversationPersistence(
  getSnapshot: () => AgentConversation[],
  saveChanges: (updated: AgentConversation[], deletedIds: string[]) => Promise<unknown>,
  intervalMs = 500,
) {
  let stored = new Map<string, AgentConversation>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null

  const schedule = () => {
    // 不因新片段重置计时器，避免长回复一直无法保存。
    if (timer !== null || running) return
    timer = setTimeout(() => {
      timer = null
      void flush().catch((error) => console.warn('保存 Agent 对话失败', error))
    }, intervalMs)
  }

  const flush = async (): Promise<void> => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (running) {
      await running
      return flush()
    }

    const snapshot = getSnapshot()
    const next = new Map(snapshot.map((conversation) => [conversation.id, conversation]))
    const updated = snapshot.filter((conversation) => stored.get(conversation.id) !== conversation)
    const deletedIds = [...stored.keys()].filter((id) => !next.has(id))
    if (!updated.length && !deletedIds.length) return

    running = (async () => {
      await saveChanges(updated, deletedIds)
      stored = next
    })()
    try {
      await running
    } finally {
      running = null
      if (getSnapshot() !== snapshot) schedule()
    }
  }

  return { schedule, flush }
}
