export const WORKBENCH_PERSIST_BASE_KEY = 'gpt-image-playground'
export const LEGACY_DB_NAME = 'gpt-image-playground'
export const LEGACY_OWNER_CLAIM_KEY = 'gpt-image-playground-legacy-owner-v1'
export const LEGACY_DB_MIGRATED_KEY = 'gpt-image-playground-legacy-db-migrated-v1'

const LEGACY_LOCAL_STORAGE_KEYS = [
  WORKBENCH_PERSIST_BASE_KEY,
  'gpt-image-playground-canvas-asset-metadata-v1',
  'gpt-image-playground-canvas-prompts-v1',
  'gpt-image-playground-gallery-density',
] as const

let currentWorkbenchOwner = ''

export function normalizeWorkbenchOwner(owner: unknown): string {
  return typeof owner === 'string' ? owner.trim() : ''
}

export function getWorkbenchOwner(): string {
  return currentWorkbenchOwner
}

export function setWorkbenchOwner(owner: string): void {
  currentWorkbenchOwner = normalizeWorkbenchOwner(owner)
}

export function getOwnerScopedKey(baseKey: string, owner = currentWorkbenchOwner): string {
  const normalized = normalizeWorkbenchOwner(owner)
  return normalized ? `${baseKey}:${normalized}` : baseKey
}

export function getOwnerDbName(owner = currentWorkbenchOwner): string {
  const normalized = normalizeWorkbenchOwner(owner)
  return normalized ? `${LEGACY_DB_NAME}:${normalized}` : LEGACY_DB_NAME
}

/**
 * 首次启用按用户隔离时，由最先登录的账号一次性认领浏览器里未分区的旧工作台数据；
 * 认领标记写入后，后续切换的其他账号将获得完全空白的隔离空间，不会继承前者数据。
 */
export function claimLegacyWorkbenchLocalStorage(owner: string): boolean {
  const normalized = normalizeWorkbenchOwner(owner)
  if (!normalized || typeof localStorage === 'undefined') return false
  try {
    const claimedBy = localStorage.getItem(LEGACY_OWNER_CLAIM_KEY)
    if (!claimedBy) {
      localStorage.setItem(LEGACY_OWNER_CLAIM_KEY, normalized)
    } else if (claimedBy !== normalized) {
      return false
    }

    for (const baseKey of LEGACY_LOCAL_STORAGE_KEYS) {
      const legacyValue = localStorage.getItem(baseKey)
      if (legacyValue == null) continue
      const scopedKey = getOwnerScopedKey(baseKey, normalized)
      if (localStorage.getItem(scopedKey) == null) {
        localStorage.setItem(scopedKey, legacyValue)
      }
    }
    return true
  } catch {
    return false
  }
}

export function isLegacyOwnerClaimedBy(owner = currentWorkbenchOwner): boolean {
  const normalized = normalizeWorkbenchOwner(owner)
  if (!normalized || typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(LEGACY_OWNER_CLAIM_KEY) === normalized
  } catch {
    return false
  }
}


// 独立协调库只存旧数据的归属。读写事务让两个首次打开的标签页只能有一个认领者。
export async function claimLegacyWorkbenchForSession(owner: string): Promise<void> {
  if (typeof indexedDB === 'undefined' || typeof localStorage === 'undefined') return
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME + ':coordination', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('migration')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    const claimed = await new Promise<string>((resolve, reject) => {
      const tx = db.transaction('migration', 'readwrite')
      const store = tx.objectStore('migration')
      const current = store.get('legacyOwner')
      let winner: string
      current.onsuccess = () => {
        winner = normalizeWorkbenchOwner(current.result)
          || normalizeWorkbenchOwner(localStorage.getItem(LEGACY_OWNER_CLAIM_KEY)) || owner
        if (!current.result) store.put(winner, 'legacyOwner')
      }
      tx.oncomplete = () => resolve(winner)
      tx.onabort = () => reject(tx.error)
    })
    if (claimed === owner) claimLegacyWorkbenchLocalStorage(owner)
  } finally {
    db.close()
  }
}

const tabId = globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2)
const tabLifetime = 180_000
const getTabPrefix = () => getOwnerScopedKey(LEGACY_DB_NAME) + ':live-tab:'

export function getWorkbenchTabId() {
  return typeof window !== 'undefined' ? tabId : undefined
}

export function isAnotherWorkbenchTabActive(id?: string): boolean {
  if (!id || id === tabId || typeof localStorage === 'undefined') return false
  try {
    return Number(localStorage.getItem(getTabPrefix() + id)) > Date.now() - tabLifetime
  } catch {
    return false
  }
}

export function hasAnotherWorkbenchTab() {
  if (typeof localStorage === 'undefined') return false
  const prefix = getTabPrefix()
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key?.startsWith(prefix) && isAnotherWorkbenchTabActive(key.slice(prefix.length))) return true
    }
  } catch {
    return false
  }
  return false
}

export function startWorkbenchTabHeartbeat() {
  const prefix = getTabPrefix()
  const key = prefix + tabId
  const pulse = () => {
    try {
      localStorage.setItem(key, String(Date.now()))
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const entry = localStorage.key(index)
        if (entry?.startsWith(prefix) && !isAnotherWorkbenchTabActive(entry.slice(prefix.length)) && entry !== key) {
          localStorage.removeItem(entry)
        }
      }
    } catch {
      // IndexedDB 仍可独立保存记录。
    }
  }
  pulse()
  let heartbeat = setInterval(pulse, 30_000)
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return
    pulse()
    heartbeat = setInterval(pulse, 30_000)
  })
  window.addEventListener('pagehide', () => {
    clearInterval(heartbeat)
    try { localStorage.removeItem(key) } catch { /* 存储不可用 */ }
  })
}

type WorkbenchDeletion = { domain: 'tasks' | 'conversations'; ids: string[] }
let deletionChannel: BroadcastChannel | undefined

function getDeletionChannel() {
  if (typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') return undefined
  return deletionChannel ??= new window.BroadcastChannel(getOwnerScopedKey(LEGACY_DB_NAME) + ':deletions')
}

export function broadcastWorkbenchDeletion(domain: WorkbenchDeletion['domain'], ids: string[]) {
  if (ids.length) getDeletionChannel()?.postMessage({ domain, ids })
}

export function onWorkbenchDeletion(onDelete: (event: WorkbenchDeletion) => void) {
  const channel = getDeletionChannel()
  const listener = ({ data }: MessageEvent<WorkbenchDeletion>) => {
    if (data && (data.domain === 'tasks' || data.domain === 'conversations') && Array.isArray(data.ids)) onDelete(data)
  }
  channel?.addEventListener('message', listener)
  return () => channel?.removeEventListener('message', listener)
}
