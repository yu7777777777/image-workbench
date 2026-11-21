/**
 * 读取本站在外层 Web 应用中保存的登录密钥。
 *
 * 常驻 playground iframe 只有在账号池构建下才会通过 postMessage 拿到 key；
 * 普通构建需要共享模型列表和本站接口，所以直接读外层用 localforage 写入的 IndexedDB 密钥。
 * 键名必须与 web/src/store/auth.ts 保持一致。
 */
const AUTH_DB_NAME = 'chatgpt2api'
const AUTH_STORE_NAME = 'auth'
const AUTH_KEY_STORAGE_KEY = 'chatgpt2api_auth_key'

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function getStoredAuthKey(): Promise<string> {
  if (typeof indexedDB === 'undefined') return ''
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(AUTH_DB_NAME)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (!db.objectStoreNames.contains(AUTH_STORE_NAME)) {
      db.close()
      return ''
    }
    // IndexedDB 事务在请求全部完成后会自动提交，跨宏任务复用必抛 TransactionInactiveError；
    // 每次读取都开新事务，短暂等待后再试一次才能生效。
    const readOnce = (): Promise<unknown> =>
      requestToPromise(
        db.transaction(AUTH_STORE_NAME, 'readonly').objectStore(AUTH_STORE_NAME).get(AUTH_KEY_STORAGE_KEY),
      )
    let value = await readOnce()
    if (typeof value !== 'string' || !value.trim()) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      value = await readOnce()
    }
    db.close()
    return typeof value === 'string' ? value.trim() : ''
  } catch (err) {
    console.warn('Failed to read stored auth key', err)
    return ''
  }
}
