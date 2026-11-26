import type { AgentConversation, TaskRecord, StoredImage, StoredImageThumbnail, CanvasProject } from '../types'
import { hasImageDimensions } from './size'
import {
  broadcastWorkbenchDeletion,
  getOwnerDbName,
  getWorkbenchOwner,
  isLegacyOwnerClaimedBy,
  LEGACY_DB_MIGRATED_KEY,
  LEGACY_DB_NAME,
} from './workbenchOwner'

const DB_VERSION = 5
const STORE_TASKS = 'tasks'
const STORE_IMAGES = 'images'
const STORE_THUMBNAILS = 'thumbnails'
const STORE_AGENT_CONVERSATIONS = 'agentConversations'
const STORE_CANVAS_PROJECTS = 'canvas_projects'
const STORE_CANVAS_META = 'canvas_meta'
const THUMBNAIL_MAX_SIZE = 720
const THUMBNAIL_QUALITY = 0.9
const THUMBNAIL_VERSION = 2

export const CURRENT_THUMBNAIL_VERSION = THUMBNAIL_VERSION

function createStoresOnUpgrade(db: IDBDatabase) {
  if (!db.objectStoreNames.contains(STORE_TASKS)) {
    db.createObjectStore(STORE_TASKS, { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains(STORE_IMAGES)) {
    db.createObjectStore(STORE_IMAGES, { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains(STORE_THUMBNAILS)) {
    db.createObjectStore(STORE_THUMBNAILS, { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains(STORE_AGENT_CONVERSATIONS)) {
    db.createObjectStore(STORE_AGENT_CONVERSATIONS, { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains(STORE_CANVAS_PROJECTS)) {
    db.createObjectStore(STORE_CANVAS_PROJECTS, { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains(STORE_CANVAS_META)) {
    db.createObjectStore(STORE_CANVAS_META)
  }
}

function openNamedDB(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION)
    req.onupgradeneeded = (e) => {
      createStoresOnUpgrade((e.target as IDBOpenDBRequest).result)
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
}

function openDB(): Promise<IDBDatabase> {
  return openNamedDB(getOwnerDbName())
}

const ALL_DB_STORES = [
  STORE_TASKS,
  STORE_IMAGES,
  STORE_THUMBNAILS,
  STORE_AGENT_CONVERSATIONS,
  STORE_CANVAS_PROJECTS,
  STORE_CANVAS_META,
] as const

function readAllStoreEntries(db: IDBDatabase, storeName: string): Promise<Array<{ key: IDBValidKey; value: unknown }>> {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve([])
      return
    }
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const entries: Array<{ key: IDBValidKey; value: unknown }> = []
    const cursorReq = store.openCursor()
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result
      if (!cursor) {
        resolve(entries)
        return
      }
      entries.push({ key: cursor.key, value: cursor.value })
      cursor.continue()
    }
    cursorReq.onerror = () => reject(cursorReq.error)
  })
}

/**
 * 首次启用按用户隔离时，若当前用户已认领旧版未分区本地数据，
 * 把旧 `gpt-image-playground` IndexedDB 中的记录一次性复制到该用户的隔离库中。
 */
export async function migrateLegacyDbToOwner(owner = getWorkbenchOwner()): Promise<void> {
  if (!owner || typeof indexedDB === 'undefined') return
  if (!isLegacyOwnerClaimedBy(owner)) return
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(LEGACY_DB_MIGRATED_KEY) === 'atomic-v1') return
    if (typeof indexedDB.databases === 'function') {
      const dbs = await indexedDB.databases()
      if (!dbs.some((item) => item.name === LEGACY_DB_NAME)) {
        if (typeof localStorage !== 'undefined') localStorage.setItem(LEGACY_DB_MIGRATED_KEY, 'atomic-v1')
        return
      }
    }
    const targetDbName = getOwnerDbName(owner)
    if (targetDbName === LEGACY_DB_NAME) return

    const [legacyDb, targetDb] = await Promise.all([
      openNamedDB(LEGACY_DB_NAME),
      openNamedDB(targetDbName),
    ])
    try {
      const source = await Promise.all(ALL_DB_STORES.map((name) => readAllStoreEntries(legacyDb, name)))
      await runTransaction(targetDb, [...ALL_DB_STORES], 'readwrite', (tx) => {
        const meta = tx.objectStore(STORE_CANVAS_META)
        const marker = meta.get(LEGACY_DB_MIGRATED_KEY)
        marker.onsuccess = () => {
          if (marker.result === 'done') return
          for (const [index, name] of ALL_DB_STORES.entries()) {
            const target = tx.objectStore(name)
            for (const { key, value } of source[index]) {
              const previous = target.getKey(key)
              previous.onsuccess = () => {
                if (previous.result !== undefined) return
                if (name === STORE_CANVAS_META) target.add(value, key)
                else putIfLive(tx, name, key, value, false)
              }
            }
          }
          meta.put('done', LEGACY_DB_MIGRATED_KEY)
        }
      })
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LEGACY_DB_MIGRATED_KEY, 'atomic-v1')
      }
    } finally {
      legacyDb.close()
      targetDb.close()
    }
  } catch (err) {
    console.warn('迁移旧版工作台 IndexedDB 数据失败', err)
  }
}

function runTransaction<T>(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  start: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction(stores, mode)
    } catch (error) {
      reject(error)
      return
    }
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    let request: IDBRequest<T> | void
    try {
      request = start(tx)
    } catch (error) {
      tx.abort()
      reject(error)
      return
    }
    tx.oncomplete = () => resolve(request?.result as T)
  })
}

async function inWorkbenchDb<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  start: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T> {
  const db = await openDB()
  try {
    return await runTransaction(db, stores, mode, start)
  } finally {
    db.close()
  }
}

function dbTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return inWorkbenchDb(storeName, mode, (tx) => fn(tx.objectStore(storeName)))
}

function deletionKey(storeName: string, id: IDBValidKey): string {
  return 'deleted:' + storeName + ':' + String(id)
}

function recordDeletion(tx: IDBTransaction, storeName: string, id: IDBValidKey) {
  tx.objectStore(STORE_CANVAS_META).put(true, deletionKey(storeName, id))
  tx.objectStore(storeName).delete(id)
}

export type DeletedAgentElements = { conversationId: string; rounds: string[]; messages: string[] }

function deletedElementsKey(id: string) {
  return 'deleted:agent-elements:' + id
}

function recordAgentElementDeletions(tx: IDBTransaction, removed: DeletedAgentElements) {
  const meta = tx.objectStore(STORE_CANVAS_META)
  const key = deletedElementsKey(removed.conversationId)
  const existing = meta.get(key)
  existing.onsuccess = () => {
    const previous = existing.result as DeletedAgentElements | undefined
    meta.put({
      conversationId: removed.conversationId,
      rounds: [...new Set([...(previous?.rounds ?? []), ...removed.rounds])],
      messages: [...new Set([...(previous?.messages ?? []), ...removed.messages])],
    }, key)
  }
}

function omitDeletedAgentElements(conversation: AgentConversation, removed: DeletedAgentElements | undefined) {
  if (!removed) return conversation
  const roundIds = new Set(removed.rounds)
  const messageIds = new Set(removed.messages)
  const rounds = conversation.rounds.filter((round) => !roundIds.has(round.id)).map((round) =>
    round.assistantMessageId && messageIds.has(round.assistantMessageId)
      ? { ...round, assistantMessageId: undefined } : round,
  )
  return {
    ...conversation,
    activeRoundId: conversation.activeRoundId && roundIds.has(conversation.activeRoundId)
      ? rounds[rounds.length - 1]?.id ?? null : conversation.activeRoundId,
    rounds,
    messages: conversation.messages.filter((message) => !messageIds.has(message.id) && !roundIds.has(message.roundId)),
  }
}

function putIfLive(tx: IDBTransaction, storeName: string, id: IDBValidKey, value: unknown, keepNewest: boolean) {
  const deleted = tx.objectStore(STORE_CANVAS_META).get(deletionKey(storeName, id))
  const store = tx.objectStore(storeName)
  deleted.onsuccess = () => {
    if (deleted.result) return
    if (!keepNewest) {
      store.put(value)
      return
    }
    const latest = store.get(id)
    latest.onsuccess = () => {
      const incoming = value as AgentConversation
      if (latest.result && latest.result.updatedAt > incoming.updatedAt) return
      const removed = tx.objectStore(STORE_CANVAS_META).get(deletedElementsKey(incoming.id))
      removed.onsuccess = () => store.put(omitDeletedAgentElements(incoming, removed.result))
    }
  }
}

function clearWithDeletions(storeName: string): Promise<undefined> {
  return inWorkbenchDb([storeName, STORE_CANVAS_META], 'readwrite', (tx) => {
    const keys = tx.objectStore(storeName).getAllKeys()
    keys.onsuccess = () => {
      for (const key of keys.result) recordDeletion(tx, storeName, key)
    }
  })
}

// ===== Tasks =====

export function getAllTasks(): Promise<TaskRecord[]> {
  return dbTransaction(STORE_TASKS, 'readonly', (s) => s.getAll())
}

export async function putTask(task: TaskRecord, restore = false): Promise<IDBValidKey> {
  await inWorkbenchDb([STORE_TASKS, STORE_CANVAS_META], 'readwrite', (tx) => {
    if (restore) tx.objectStore(STORE_CANVAS_META).delete(deletionKey(STORE_TASKS, task.id))
    putIfLive(tx, STORE_TASKS, task.id, task, false)
  })
  return task.id
}

export async function deleteTask(id: string): Promise<undefined> {
  await inWorkbenchDb([STORE_TASKS, STORE_CANVAS_META], 'readwrite', (tx) => recordDeletion(tx, STORE_TASKS, id))
  broadcastWorkbenchDeletion('tasks', [id])
}

export async function commitTaskDeletion(
  deletedTaskIds: string[], updatedTasks: TaskRecord[], updatedConversations: AgentConversation[],
  deletedAgentElements: DeletedAgentElements[] = [],
): Promise<undefined> {
  await inWorkbenchDb([STORE_TASKS, STORE_AGENT_CONVERSATIONS, STORE_CANVAS_META], 'readwrite', (tx) => {
    for (const id of deletedTaskIds) recordDeletion(tx, STORE_TASKS, id)
    for (const removed of deletedAgentElements) recordAgentElementDeletions(tx, removed)
    for (const task of updatedTasks) putIfLive(tx, STORE_TASKS, task.id, task, false)
    for (const conversation of updatedConversations) putIfLive(tx, STORE_AGENT_CONVERSATIONS, conversation.id, conversation, true)
  })
  broadcastWorkbenchDeletion('tasks', deletedTaskIds)
}

export function clearTasks(): Promise<undefined> {
  return clearWithDeletions(STORE_TASKS)
}

// ===== Agent conversations =====

export function getAllAgentConversations(): Promise<AgentConversation[]> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readonly', (s) => s.getAll())
}

export async function putAgentConversation(conversation: AgentConversation): Promise<IDBValidKey> {
  await saveAgentConversationChanges([conversation], [])
  return conversation.id
}

export function clearAgentConversations(): Promise<undefined> {
  return clearWithDeletions(STORE_AGENT_CONVERSATIONS)
}

export async function saveAgentConversationChanges(updated: AgentConversation[], deletedIds: string[]): Promise<void> {
  await inWorkbenchDb([STORE_AGENT_CONVERSATIONS, STORE_CANVAS_META], 'readwrite', (tx) => {
    for (const id of deletedIds) recordDeletion(tx, STORE_AGENT_CONVERSATIONS, id)
    for (const conversation of updated) putIfLive(tx, STORE_AGENT_CONVERSATIONS, conversation.id, conversation, true)
  })
  broadcastWorkbenchDeletion('conversations', deletedIds)
}

export function replaceAgentConversations(conversations: AgentConversation[], restore = false): Promise<undefined> {
  // Hydration and imports reconcile snapshots. An absent row may have been added by another tab.
  return inWorkbenchDb([STORE_AGENT_CONVERSATIONS, STORE_CANVAS_META], 'readwrite', (tx) => {
    for (const conversation of conversations) {
      if (restore) {
        tx.objectStore(STORE_CANVAS_META).delete(deletionKey(STORE_AGENT_CONVERSATIONS, conversation.id))
        tx.objectStore(STORE_CANVAS_META).delete(deletedElementsKey(conversation.id))
      }
      putIfLive(tx, STORE_AGENT_CONVERSATIONS, conversation.id, conversation, true)
    }
  })
}

// ===== Images =====

export function getImage(id: string): Promise<StoredImage | undefined> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.get(id))
}

export function getStoredImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  return dbTransaction(STORE_THUMBNAILS, 'readonly', (s) => s.get(id))
}

export async function getStoredFreshImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  const thumbnail = await getStoredImageThumbnail(id)
  return thumbnail?.thumbnailVersion === THUMBNAIL_VERSION ? thumbnail : undefined
}

export function putImageThumbnail(thumbnail: StoredImageThumbnail): Promise<IDBValidKey> {
  return dbTransaction(STORE_THUMBNAILS, 'readwrite', (s) => s.put(thumbnail))
}

export async function getImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  const existingThumbnail = await getStoredImageThumbnail(id)
  if (existingThumbnail?.thumbnailVersion === THUMBNAIL_VERSION) {
    const image = await getImage(id)
    if (image && (!image.width || !image.height) && existingThumbnail.width && existingThumbnail.height) {
      await putImage({ ...image, width: existingThumbnail.width, height: existingThumbnail.height })
    }
    return existingThumbnail
  }

  const image = await getImage(id)
  if (!image) return undefined
  const legacyImage = image as StoredImage & Partial<StoredImageThumbnail>
  if (legacyImage.thumbnailDataUrl && legacyImage.thumbnailVersion === THUMBNAIL_VERSION) {
    const thumbnail: StoredImageThumbnail = {
      id,
      thumbnailDataUrl: legacyImage.thumbnailDataUrl,
      width: legacyImage.width,
      height: legacyImage.height,
      thumbnailVersion: THUMBNAIL_VERSION,
    }
    await putImageThumbnail(thumbnail)
    if ((!image.width || !image.height) && thumbnail.width && thumbnail.height) {
      await putImage({ ...image, width: thumbnail.width, height: thumbnail.height })
    }
    return thumbnail
  }

  const metadata = await safeCreateImageThumbnail(image.dataUrl)
  if (!metadata.thumbnailDataUrl) return undefined
  const thumbnail: StoredImageThumbnail = {
    id,
    thumbnailDataUrl: metadata.thumbnailDataUrl,
    width: metadata.width,
    height: metadata.height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
  await putImageThumbnail(thumbnail)
  if (metadata.width && metadata.height && (image.width !== metadata.width || image.height !== metadata.height)) {
    await putImage({ ...image, width: metadata.width, height: metadata.height })
  }
  return thumbnail
}

export function getAllImages(): Promise<StoredImage[]> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.getAll())
}

export function getAllImageIds(): Promise<string[]> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.getAllKeys()).then((keys) =>
    keys.map(String),
  )
}

export function putImage(image: StoredImage): Promise<IDBValidKey> {
  return dbTransaction(STORE_IMAGES, 'readwrite', (s) => s.put(image))
}

/** 把图片真实宽高写回 images 与 thumbnails 两条记录；图片不存在时返回 false。 */
export async function updateImageDimensions(id: string, width: number, height: number): Promise<boolean> {
  if (!hasImageDimensions({ width, height })) throw new Error('图片尺寸无效')
  const image = await getImage(id)
  if (!image) return false
  if (image.width !== width || image.height !== height) {
    await putImage({ ...image, width, height })
  }
  const thumbnail = await getStoredImageThumbnail(id)
  if (thumbnail && (thumbnail.width !== width || thumbnail.height !== height)) {
    await putImageThumbnail({ ...thumbnail, width, height })
  }
  return true
}

const imageDimensionsPending = new Map<string, Promise<{ width: number; height: number } | undefined>>()

/**
 * 读取图片真实宽高，缺失时逐级降级补全：
 * 图片记录 → 缩略图记录（可信证据，写回）→ 解码原图（写回）。
 * 同一图片的并发请求共享同一个 Promise。
 */
export function getImageDimensions(id: string): Promise<{ width: number; height: number } | undefined> {
  const pending = imageDimensionsPending.get(id)
  if (pending) return pending

  const request = (async () => {
    const image = await getImage(id)
    if (!image) return undefined
    if (hasImageDimensions(image)) return { width: image.width, height: image.height }

    const thumbnail = await getStoredImageThumbnail(id)
    if (hasImageDimensions(thumbnail)) {
      const size = { width: thumbnail.width, height: thumbnail.height }
      await updateImageDimensions(id, size.width, size.height)
      return size
    }

    const decoded = await loadImage(image.dataUrl)
    const size = { width: decoded.naturalWidth, height: decoded.naturalHeight }
    if (size.width > 0 && size.height > 0) {
      await updateImageDimensions(id, size.width, size.height)
      return size
    }
    return undefined
  })()
    .catch(() => undefined)
    .finally(() => imageDimensionsPending.delete(id))

  imageDimensionsPending.set(id, request)
  return request
}

export function deleteImage(id: string): Promise<undefined> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_IMAGES, STORE_THUMBNAILS], 'readwrite')
        tx.objectStore(STORE_IMAGES).delete(id)
        tx.objectStore(STORE_THUMBNAILS).delete(id)
        tx.oncomplete = () => resolve(undefined)
        tx.onerror = () => reject(tx.error)
      }),
  )
}

export function clearImages(): Promise<undefined> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_IMAGES, STORE_THUMBNAILS], 'readwrite')
        tx.objectStore(STORE_IMAGES).clear()
        tx.objectStore(STORE_THUMBNAILS).clear()
        tx.oncomplete = () => resolve(undefined)
        tx.onerror = () => reject(tx.error)
      }),
  )
}

// ===== Image hashing & dedup =====

export async function hashDataUrl(dataUrl: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return hashDataUrlFallback(dataUrl)
  }

  const data = new TextEncoder().encode(dataUrl)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hashDataUrlFallback(dataUrl: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193

  for (let i = 0; i < dataUrl.length; i++) {
    const code = dataUrl.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= code
    h2 = Math.imul(h2, 0x27d4eb2d)
  }

  return `fallback-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

export interface StoreImageResult {
  id: string
  width?: number
  height?: number
}

/**
 * 存储图片，若已存在（按 hash 去重）则跳过。
 * 返回 image id 及图片真实宽高。
 */
export async function storeImage(dataUrl: string, source: NonNullable<StoredImage['source']> = 'upload'): Promise<string> {
  return (await storeImageWithSize(dataUrl, source)).id
}

export async function storeImageWithSize(dataUrl: string, source: NonNullable<StoredImage['source']> = 'upload'): Promise<StoreImageResult> {
  const id = await hashDataUrl(dataUrl)
  const existing = await getImage(id)
  if (!existing) {
    const thumbnail = await safeCreateImageThumbnail(dataUrl)
    await putImage({
      id,
      dataUrl,
      createdAt: Date.now(),
      source,
      width: thumbnail.width,
      height: thumbnail.height,
    })
    if (thumbnail.thumbnailDataUrl) {
      await putImageThumbnail({
        id,
        thumbnailDataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: THUMBNAIL_VERSION,
      })
    }
    return { id, width: thumbnail.width, height: thumbnail.height }
  }

  if ((await getStoredImageThumbnail(id))?.thumbnailVersion !== THUMBNAIL_VERSION) {
    const thumbnail = await safeCreateImageThumbnail(existing.dataUrl)
    const width = thumbnail.width ?? existing.width
    const height = thumbnail.height ?? existing.height
    if (thumbnail.width && thumbnail.height && (existing.width !== thumbnail.width || existing.height !== thumbnail.height)) {
      await putImage({ ...existing, width: thumbnail.width, height: thumbnail.height })
    }
    if (thumbnail.thumbnailDataUrl) {
      await putImageThumbnail({
        id,
        thumbnailDataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: THUMBNAIL_VERSION,
      })
    }
    return { id, width, height }
  }
  return { id, width: existing.width, height: existing.height }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = dataUrl
  })
}

async function createImageThumbnail(dataUrl: string): Promise<Omit<StoredImageThumbnail, 'id'>> {
  const image = await loadImage(dataUrl)
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (width <= 0 || height <= 0) throw new Error('图片尺寸无效')

  const scale = Math.min(1, THUMBNAIL_MAX_SIZE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  return {
    thumbnailDataUrl: canvas.toDataURL('image/webp', THUMBNAIL_QUALITY),
    width,
    height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
}

async function safeCreateImageThumbnail(dataUrl: string): Promise<Partial<Omit<StoredImageThumbnail, 'id'>>> {
  try {
    return await createImageThumbnail(dataUrl)
  } catch {
    return {}
  }
}

// ===== Canvas Projects =====

export function putCanvasProject(project: CanvasProject): Promise<IDBValidKey> {
  return dbTransaction(STORE_CANVAS_PROJECTS, 'readwrite', (s) => s.put(project))
}

export function getCanvasProject(id: string): Promise<CanvasProject | undefined> {
  return dbTransaction(STORE_CANVAS_PROJECTS, 'readonly', (s) => s.get(id))
}

export function listCanvasProjects(): Promise<CanvasProject[]> {
  return dbTransaction(STORE_CANVAS_PROJECTS, 'readonly', (s) => s.getAll())
}

export function deleteCanvasProject(id: string): Promise<undefined> {
  return dbTransaction(STORE_CANVAS_PROJECTS, 'readwrite', (s) => s.delete(id))
}

export function clearCanvasProjects(): Promise<undefined> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_CANVAS_PROJECTS, STORE_CANVAS_META], 'readwrite')
        tx.objectStore(STORE_CANVAS_PROJECTS).clear()
        tx.objectStore(STORE_CANVAS_META).delete('activeProjectId')
        tx.oncomplete = () => resolve(undefined)
        tx.onerror = () => reject(tx.error)
      }),
  )
}

export function getActiveCanvasProjectId(): Promise<string | undefined> {
  return dbTransaction(STORE_CANVAS_META, 'readonly', (s) => s.get('activeProjectId'))
}

export function putActiveCanvasProjectId(id: string): Promise<IDBValidKey> {
  return dbTransaction(STORE_CANVAS_META, 'readwrite', (s) => s.put(id, 'activeProjectId'))
}
