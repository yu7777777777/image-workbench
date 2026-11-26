import { DEFAULT_SETTINGS, normalizeAgentMaxToolRounds } from './apiProfiles'
import type { StateStorage } from 'zustand/middleware'
import type { AppSettings } from '../types'
import { getOwnerScopedKey, WORKBENCH_PERSIST_BASE_KEY } from './workbenchOwner'

const patchFields = [
  'enterSubmit', 'clearInputAfterSubmit', 'persistInputOnRestart', 'reuseTaskApiProfileTemporarily',
  'alwaysShowRetryButton', 'allowPromptRewrite', 'taskCompletionNotification', 'agentWebSearch',
  'agentApiConfigMode', 'agentMaxToolRounds',
] as const

type Fields = typeof patchFields[number]
type Persisted = { version?: number; state?: { settings?: Record<string, unknown>; [key: string]: unknown } }

function parseState(raw: string | null): Persisted {
  try {
    const value = JSON.parse(raw ?? 'null')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

function mergeChanges(previous: Record<string, unknown>, latest: Record<string, unknown>, incoming: Record<string, unknown>) {
  const result = { ...latest }
  for (const key of new Set([...Object.keys(previous), ...Object.keys(incoming)])) {
    if (JSON.stringify(previous[key]) === JSON.stringify(incoming[key])) continue
    if (Object.prototype.hasOwnProperty.call(incoming, key)) result[key] = incoming[key]
    else delete result[key]
  }
  return result
}

function readCommittedSettings(key: string, fallback: Record<string, unknown> = {}) {
  const settings = { ...fallback }
  for (const field of patchFields) {
    const raw = localStorage.getItem(key + ':settings-field:' + field)
    if (raw == null) continue
    try {
      settings[field] = JSON.parse(raw).value
    } catch {
      continue
    }
  }
  return settings
}

export function createWorkbenchStateStorage(): StateStorage {
  let observedByStore: Persisted = {}
  return {
    getItem: (name) => {
      if (typeof localStorage === 'undefined') return null
      const key = getOwnerScopedKey(name)
      const raw = localStorage.getItem(key)
      const parsed = parseState(raw)
      const settings = readCommittedSettings(key, parsed.state?.settings)
      if (raw == null && !Object.keys(settings).length) {
        observedByStore = {}
        return null
      }
      observedByStore = { ...parsed, state: { ...parsed.state, settings } }
      return JSON.stringify(observedByStore)
    },
    setItem: (name, value) => {
      if (typeof localStorage === 'undefined') return
      const key = getOwnerScopedKey(name)
      const incoming = parseState(value)
      const latest = parseState(localStorage.getItem(key))
      const previous = observedByStore.state ?? {}
      if ((latest.version ?? 0) > (incoming.version ?? 0)) return
      const state = mergeChanges(previous, latest.state ?? {}, incoming.state ?? {})
      const nextSettings = incoming.state?.settings ?? {}
      for (const field of patchFields) {
        if (typeof nextSettings[field] === 'undefined' || nextSettings[field] === (previous.settings?.[field] ?? DEFAULT_SETTINGS[field])) continue
        localStorage.setItem(key + ':settings-field:' + field, JSON.stringify({ value: nextSettings[field] }))
      }
      state.settings = readCommittedSettings(
        key,
        mergeChanges(previous.settings ?? {}, latest.state?.settings ?? {}, nextSettings),
      )
      localStorage.setItem(key, JSON.stringify({ ...incoming, state }))
      observedByStore = incoming
    },
    removeItem: (name) => {
      if (typeof localStorage === 'undefined') return
      const key = getOwnerScopedKey(name)
      localStorage.removeItem(key)
      for (const field of patchFields) localStorage.removeItem(key + ':settings-field:' + field)
      observedByStore = {}
    },
  }
}

export function applyQueuedWorkbenchSettings(apply: (patch: Partial<AppSettings>) => void) {
  if (typeof localStorage === 'undefined') return
  const prefix = getOwnerScopedKey(WORKBENCH_PERSIST_BASE_KEY) + ':settings-patch:'
  const patch: Partial<Pick<AppSettings, Fields>> = {}
  const consumed: Array<[string, string]> = []
  for (const field of patchFields) {
    const key = prefix + field
    const raw = localStorage.getItem(key)
    if (raw == null) continue
    try {
      const { value } = JSON.parse(raw)
      if (field === 'agentApiConfigMode') {
        if (value === 'off' || value === 'native' || value === 'hybrid') patch[field] = value
      } else if (field === 'agentMaxToolRounds') {
        if (typeof value === 'number' && Number.isFinite(value)) patch[field] = normalizeAgentMaxToolRounds(value)
      } else if (typeof value === 'boolean') {
        patch[field] = value
      }
      consumed.push([key, raw])
    } catch {
      continue
    }
  }
  if (Object.keys(patch).length) {
    const key = getOwnerScopedKey(WORKBENCH_PERSIST_BASE_KEY)
    for (const field of patchFields) {
      if (patch[field] !== undefined) localStorage.setItem(key + ':settings-field:' + field, JSON.stringify({ value: patch[field] }))
    }
    apply(patch)
  }
  for (const [key, raw] of consumed) {
    if (localStorage.getItem(key) === raw) localStorage.removeItem(key)
  }
}
