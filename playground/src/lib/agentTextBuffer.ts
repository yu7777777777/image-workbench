// 以固定时间窗口合并文字，持续输出时也会定期刷新，不等待输出停止。
export function createAgentTextBuffer(
  publish: (conversationId: string, messageId: string, delta: string) => void,
  intervalMs = 50,
) {
  const pending = new Map<string, { conversationId: string; messageId: string; delta: string; timer: ReturnType<typeof setTimeout> }>()

  const flush = (conversationId?: string, messageId?: string) => {
    for (const [key, update] of pending) {
      if ((conversationId && update.conversationId !== conversationId) || (messageId && update.messageId !== messageId)) continue
      clearTimeout(update.timer)
      pending.delete(key)
      publish(update.conversationId, update.messageId, update.delta)
    }
  }

  return {
    append(conversationId: string, messageId: string, delta: string) {
      if (!delta) return
      const key = `${conversationId}:${messageId}`
      const update = pending.get(key)
      if (update) {
        update.delta += delta
        return
      }
      pending.set(key, {
        conversationId,
        messageId,
        delta,
        timer: setTimeout(() => flush(conversationId, messageId), intervalMs),
      })
    },
    flush,
  }
}
