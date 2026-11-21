import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApiUrl, isApiProxyLocked, normalizeBaseUrl, readClientDevProxyConfig, shouldUseApiProxy, shouldUseApiProxyForCredential, POOL_SESSION_KEY } from './devProxy'

beforeEach(() => {
  vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'false')
  vi.stubEnv('VITE_API_PROXY_LOCKED', 'false')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('shouldUseApiProxy', () => {
  it('honors an explicit proxy opt-in in production with availability but no dev config', () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')

    const config = readClientDevProxyConfig()
    expect(config).toBeNull()
    expect(shouldUseApiProxy(true, config)).toBe(true)
    expect(shouldUseApiProxyForCredential('sk-third-party', true, config)).toBe(true)
    expect(buildApiUrl('https://api.example.com', 'responses', config, shouldUseApiProxy(true, config))).toBe('/api-proxy/responses')
  })

  it('does not force a proxy when the profile opts out, even if the deployment locks it', () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    vi.stubEnv('VITE_API_PROXY_LOCKED', 'true')

    expect(isApiProxyLocked(null)).toBe(true)
    expect(shouldUseApiProxy(false, null)).toBe(false)
    expect(shouldUseApiProxyForCredential('sk-third-party', false, null)).toBe(false)
    expect(shouldUseApiProxy(false, {
      enabled: true, prefix: '/api-proxy', target: 'https://api.example.com', changeOrigin: true, secure: false,
    })).toBe(false)
  })

  it('does not treat locking alone as proxy availability', () => {
    vi.stubEnv('VITE_API_PROXY_LOCKED', 'true')

    expect(isApiProxyLocked(null)).toBe(false)
    expect(shouldUseApiProxy(true, null)).toBe(false)
  })
})

describe('shouldUseApiProxyForCredential', () => {
  // 回归：生产构建曾带 VITE_API_PROXY_LOCKED=true，本站账号池被推到 /api-proxy/*，
  // 携本站会话凭据打到外部目标，被 poolFetch 拒绝并报「本站登录凭据只能用于本站 API」。
  it('never routes the same-site account pool through the API proxy', () => {
    expect(shouldUseApiProxyForCredential(POOL_SESSION_KEY, true, null)).toBe(false)
    expect(shouldUseApiProxyForCredential(POOL_SESSION_KEY, false, null)).toBe(false)
  })

  it.each(['false', 'true'])('keeps pool credentials direct when proxy availability is %s, including locked deployments', (available) => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', available)
    vi.stubEnv('VITE_API_PROXY_LOCKED', 'true')

    const config = {
      enabled: true, prefix: '/api-proxy', target: 'https://api.example.com', changeOrigin: true, secure: false,
    }
    for (const proxyConfig of [null, config]) {
      for (const apiProxy of [false, true]) {
        const useApiProxy = shouldUseApiProxyForCredential(POOL_SESSION_KEY, apiProxy, proxyConfig)
        expect(useApiProxy).toBe(false)
        expect(buildApiUrl('', 'responses', proxyConfig, useApiProxy)).toBe('/v1/responses')
      }
    }
  })

  it('does not proxy third-party profiles when no proxy is available', () => {
    expect(shouldUseApiProxyForCredential('sk-third-party', true, null)).toBe(false)
    expect(shouldUseApiProxyForCredential('sk-third-party', false, null)).toBe(false)
    expect(shouldUseApiProxyForCredential('sk-third-party', true, {
      enabled: true, prefix: '/api-proxy', target: 'https://api.example.com', changeOrigin: true, secure: false,
    })).toBe(true)
  })
})

describe('normalizeBaseUrl', () => {
  it('preserves a trailing slash used for direct endpoint joining', () => {
    expect(normalizeBaseUrl('https://api.example.com/')).toBe('https://api.example.com/')
    expect(normalizeBaseUrl('api.example.com/custom/')).toBe('https://api.example.com/custom/')
    expect(normalizeBaseUrl('https://api.example.com/custom///')).toBe('https://api.example.com/custom/')
  })

  it('keeps the existing normalization when there is no trailing slash', () => {
    expect(normalizeBaseUrl('https://api.example.com')).toBe('https://api.example.com')
    expect(normalizeBaseUrl('https://api.example.com/custom')).toBe('https://api.example.com/custom/v1')
  })
})

describe('buildApiUrl', () => {
  it('uses the same-origin proxy prefix when API proxy is enabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'images/edits', null, true)).toBe(
      '/api-proxy/images/edits',
    )
  })

  it('leaves API versioning to the proxy target when proxying', () => {
    expect(buildApiUrl('http://api.example.com', 'images/generations', null, true)).toBe(
      '/api-proxy/images/generations',
    )
  })

  it('uses a configured proxy prefix when one is available', () => {
    expect(
      buildApiUrl(
        'http://api.example.com/v1',
        'responses',
        {
          enabled: true,
          prefix: '/openai-proxy',
          target: 'http://api.example.com/v1',
          changeOrigin: true,
          secure: false,
        },
        true,
      ),
    ).toBe('/openai-proxy/responses')
  })

  it('uses the configured API URL directly when API proxy is disabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'responses', null, false)).toBe(
      'http://api.example.com/v1/responses',
    )
  })

  it('joins the endpoint directly when the API URL ends with a slash', () => {
    expect(buildApiUrl('https://api.example.com/', '/custom/image-tasks', null, false)).toBe(
      'https://api.example.com/custom/image-tasks',
    )
  })

  it('preserves a base path when directly joining an API URL', () => {
    expect(buildApiUrl('api.example.com/custom/', 'tasks/123', null, false)).toBe(
      'https://api.example.com/custom/tasks/123',
    )
  })

  it('normalizes an API URL before directly joining an endpoint', () => {
    expect(buildApiUrl('https://user:password@api.example.com/', 'responses', null, false)).toBe(
      'https://api.example.com/responses',
    )
  })

  it('directly joins an OpenAI endpoint when its API URL ends with a slash', () => {
    expect(buildApiUrl('https://api.example.com/', 'responses', null, false)).toBe(
      'https://api.example.com/responses',
    )
  })
})
