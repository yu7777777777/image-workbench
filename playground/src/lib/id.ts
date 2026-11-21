let fallbackSequence = 0

/**
 * 生成前端本地实体 ID。
 *
 * crypto.randomUUID 只在安全上下文中保证存在，localhost 可以使用，
 * 但通过普通 HTTP 的局域网 IP 打开时可能没有该 API。画布是本地数据，
 * 在这种场景用时间戳和随机数即可保证当前页面内的 ID 唯一。
 */
export function createLocalId(prefix = 'id'): string {
  const uuid = globalThis.crypto?.randomUUID
  if (typeof uuid === 'function') return uuid.call(globalThis.crypto)
  fallbackSequence = (fallbackSequence + 1) % 1_000_000
  return `${prefix}-${Date.now().toString(36)}-${fallbackSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
