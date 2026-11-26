import { isPoolBuild, POOL_KEY } from './accountPool'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxyForCredential } from './devProxy'

export interface ModelItem {
  id: string
  kind?: 'text' | 'image'
}

export const DEFAULT_IMAGE_MODELS = [
  'gpt-image-2',
]

// 部署配置注入：从模型选择中隐藏号池无法使用的型号（构建期 VITE_HIDDEN_IMAGE_MODELS 注入，逗号分隔）。
const HIDDEN_IMAGE_MODELS = (import.meta.env.VITE_HIDDEN_IMAGE_MODELS ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)

export function filterHiddenImageModels(models: string[]): string[] {
  return models.filter((id) => !HIDDEN_IMAGE_MODELS.includes(id))
}

export interface AvailableImageModelsResult {
  ok: boolean
  models: string[]
}

const availableImageModelsCache = new Map<string, string[]>()

function resolveModelsEndpoint(apiKey?: string, baseUrl = '', apiProxy = false) {
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = !isPoolBuild && shouldUseApiProxyForCredential(apiKey, apiProxy, proxyConfig)
  const authKey = isPoolBuild ? POOL_KEY : useApiProxy ? 'local-proxy-placeholder' : apiKey || POOL_KEY
  const url = isPoolBuild ? `${window.location.origin}/v1/models` : buildApiUrl(baseUrl, 'models', proxyConfig, useApiProxy)
  const cacheKey = `${isPoolBuild ? 'pool' : 'direct'}::${url}::${useApiProxy ? 'proxy' : authKey}`
  return { url, authKey, cacheKey }
}

export function getCachedAvailableImageModels(apiKey?: string, baseUrl = '', apiProxy = false): string[] | null {
  try {
    const { cacheKey } = resolveModelsEndpoint(apiKey, baseUrl, apiProxy)
    const cached = availableImageModelsCache.get(cacheKey)
    return cached ? [...cached] : null
  } catch {
    return null
  }
}

export function clearAvailableImageModelsCache() {
  availableImageModelsCache.clear()
}

export async function fetchAvailableImageModelsResult(apiKey?: string, baseUrl = '', apiProxy = false): Promise<AvailableImageModelsResult> {
  const fallback = isPoolBuild ? [] : DEFAULT_IMAGE_MODELS
  try {
    const { url, authKey, cacheKey } = resolveModelsEndpoint(apiKey, baseUrl, apiProxy)
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(authKey ? { Authorization: `Bearer ${authKey}` } : {}),
      },
    })
    if (!res.ok) return { ok: false, models: fallback }
    const data = (await res.json()) as { data?: ModelItem[] }
    if (Array.isArray(data?.data)) {
      const filtered = data.data
        .filter((m) => m.kind === 'image' || (!m.kind && /image/i.test(m.id) && !/codex/i.test(m.id)))
        .map((m) => String(m.id || '').trim())
        .filter((id, idx, arr) => id && arr.indexOf(id) === idx)
      if (filtered.length > 0) {
        const order = [
          'gpt-image-2',
          'plus-gpt-image-2',
          'pro-gpt-image-2',
          'team-gpt-image-2',
          'gpt-image-2.5',
          'gpt-image-2.5-flare',
          'gpt-image-2.5-sunburst',
        ]
        filtered.sort((a, b) => {
          const idxA = order.indexOf(a)
          const idxB = order.indexOf(b)
          if (idxA !== -1 && idxB !== -1) return idxA - idxB
          if (idxA !== -1) return -1
          if (idxB !== -1) return 1
          return a.localeCompare(b)
        })
        availableImageModelsCache.set(cacheKey, filtered)
        return { ok: true, models: filtered }
      }
      availableImageModelsCache.set(cacheKey, fallback)
      return { ok: true, models: fallback }
    }
    return { ok: false, models: fallback }
  } catch {
    return { ok: false, models: fallback }
  }
}

export async function fetchAvailableImageModels(apiKey?: string, baseUrl = '', apiProxy = false): Promise<string[]> {
  const result = await fetchAvailableImageModelsResult(apiKey, baseUrl, apiProxy)
  return result.models
}
