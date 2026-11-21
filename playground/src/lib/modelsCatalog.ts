import { isPoolBuild, POOL_KEY } from './accountPool'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy, shouldUseApiProxyForCredential } from './devProxy'

export interface ModelItem {
  id: string
  object?: string
}

export const DEFAULT_IMAGE_MODELS = [
  'gpt-image-2',
]
export const DEFAULT_POOL_IMAGE_MODELS = [
  'gpt-image-2',
  'gpt-image-2.5',
  'gpt-image-2.5-flare',
  'gpt-image-2.5-sunburst',
]

// 部署配置注入：从模型选择中隐藏号池无法使用的型号（构建期 VITE_HIDDEN_IMAGE_MODELS 注入，逗号分隔）。
const HIDDEN_IMAGE_MODELS = (import.meta.env.VITE_HIDDEN_IMAGE_MODELS ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)

export function filterHiddenImageModels(models: string[]): string[] {
  return models.filter((id) => !HIDDEN_IMAGE_MODELS.includes(id))
}

export async function fetchAvailableImageModels(apiKey?: string, baseUrl = '', apiProxy = false): Promise<string[]> {
  try {
    // The pool build must read the pool catalog even when the currently
    // selected profile is a shared/local provider. Otherwise the selector
    // loses the site's 2.5 models after switching profiles.
    const proxyConfig = readClientDevProxyConfig()
    const useApiProxy = shouldUseApiProxyForCredential(apiKey, apiProxy, proxyConfig)
    const authKey = useApiProxy ? 'local-proxy-placeholder' : (isPoolBuild ? POOL_KEY : (apiKey || POOL_KEY))
    const res = await fetch(buildApiUrl(baseUrl, 'models', proxyConfig, useApiProxy), {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(authKey ? { Authorization: `Bearer ${authKey}` } : {}),
      },
    })
    if (!res.ok) return useApiProxy || isPoolBuild ? DEFAULT_POOL_IMAGE_MODELS : DEFAULT_IMAGE_MODELS
    const data = (await res.json()) as { data?: ModelItem[] }
    if (Array.isArray(data?.data)) {
      const filtered = data.data
        .map((m) => String(m.id || '').trim())
        .filter((id, idx, arr) => {
          const lower = id.toLowerCase()
          return lower.includes('image') && !lower.includes('codex') && arr.indexOf(id) === idx
        })
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
        return filtered
      }
    }
    return useApiProxy || isPoolBuild ? DEFAULT_POOL_IMAGE_MODELS : DEFAULT_IMAGE_MODELS
  } catch {
    return isPoolBuild || readClientDevProxyConfig()?.enabled ? DEFAULT_POOL_IMAGE_MODELS : DEFAULT_IMAGE_MODELS
  }
}
