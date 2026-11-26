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
