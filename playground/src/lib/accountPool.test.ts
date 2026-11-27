import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { fetchSharedProfiles, POOL_AGENT_PROFILE_ID, POOL_KEY, POOL_PROFILE_ID, poolFetch, poolSettings, refreshSharedProfiles, setSharedProfilesAuth } from './accountPool'
import { normalizeParamsForSettings } from './paramCompatibility'
import { DEFAULT_PARAMS } from '../types'
import { useStore } from '../store'

describe('account pool integration', () => {
  it('bypasses cached HTML and exposes enabled shared chat and image profiles', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ shared_profiles: [
      { id: 'chat', name: 'Shared chat', role: 'chat', provider: 'openai', model: 'chat-model', enabled: true },
      { id: 'image', name: 'Shared image', role: 'image', provider: 'openai', model: 'image-model', enabled: true },
      { id: 'disabled', name: 'Hidden', role: 'image', enabled: false },
    ] }))
    vi.stubGlobal('fetch', fetcher)
    try {
      await fetchSharedProfiles('test-session', 'https://pool.example')
      expect(fetcher).toHaveBeenCalledWith('https://pool.example/api/shared-profiles', {
        headers: { Authorization: 'Bearer test-session' }, cache: 'no-store',
      })
      const profiles = poolSettings(DEFAULT_SETTINGS, 'https://pool.example').profiles!
      expect(profiles.find((profile) => profile.id === 'shared-chat')).toMatchObject({ apiMode: 'responses', model: 'chat-model' })
      expect(profiles.find((profile) => profile.id === 'shared-image')).toMatchObject({ apiMode: 'images', model: 'image-model', apiProxy: true })
      expect(profiles.some((profile) => profile.id === 'shared-disabled')).toBe(false)
    } finally { vi.unstubAllGlobals() }
  })

  // 回归：普通用户登录后会话令牌不是 POOL_KEY，旧实现会让 refreshSharedProfiles 直接 return，
  // 导致「对话模型」下拉框里看不到本站共享模型（管理员却能看到）。
  it('refreshes shared profiles for ordinary users with any injected session key', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ shared_profiles: [
      { id: 'chat', name: 'Shared chat', role: 'chat', provider: 'openai', model: 'chat-model', enabled: true },
      { id: 'deepseek', name: 'deepseek-v4.1-flash 对话', role: 'chat', provider: 'openai', model: 'deepseek-v4.1-flash', enabled: true },
    ] }))
    vi.stubGlobal('fetch', fetcher)
    setSharedProfilesAuth({ kind: 'bearer', token: 'ordinary-user-key' })
    try {
      await expect(refreshSharedProfiles('https://pool.example')).resolves.toBe(true)
      expect(fetcher).toHaveBeenCalledWith('https://pool.example/api/shared-profiles', {
        headers: { Authorization: 'Bearer ordinary-user-key' }, cache: 'no-store',
      })
      expect(useStore.getState().settings.profiles.some((profile) => profile.id === 'shared-deepseek')).toBe(true)
    } finally {
      setSharedProfilesAuth(null)
      vi.unstubAllGlobals()
    }
  })

  // 回归：拉取失败（非 2xx / 网络 error）必须返回 false 让上层退避重试，
  // 旧实现吞掉失败照样返回 true，一次网络抖动就让共享模型缺失且不再重试。
  it('returns false when the shared-profiles request fails so callers retry', async () => {
    setSharedProfilesAuth({ kind: 'bearer', token: 'ordinary-user-key' })
    const fetcher = vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 }))
    vi.stubGlobal('fetch', fetcher)
    try {
      await expect(refreshSharedProfiles('https://pool.example')).resolves.toBe(false)
    } finally {
      setSharedProfilesAuth(null)
      vi.unstubAllGlobals()
    }

    const networkFetcher = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', networkFetcher)
    setSharedProfilesAuth({ kind: 'bearer', token: 'ordinary-user-key' })
    try {
      await expect(refreshSharedProfiles('https://pool.example')).resolves.toBe(false)
    } finally {
      setSharedProfilesAuth(null)
      vi.unstubAllGlobals()
    }
  })

  it('configures the supported model and caps requests at four PNG images', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ shared_profiles: [] }))
    vi.stubGlobal('fetch', fetcher)
    try {
      // 通过公开接口安排空共享列表，避免继承前面用例留下的缓存。
      await fetchSharedProfiles('test-session', 'https://pool.example')
      const settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...poolSettings(DEFAULT_SETTINGS, 'https://pool.example') })
      const poolProfile = settings.profiles.find((profile) => profile.id === POOL_PROFILE_ID)
      expect(poolProfile).toMatchObject({ model: 'gpt-image-2', apiMode: 'images', apiProxy: false })
      expect(settings.profiles.some((profile) => profile.id === 'default-openai')).toBe(true)
      expect(settings.model).toBe('gpt-image-2')
      expect(settings.profiles.find((profile) => profile.id === 'chatgpt2api-pool-agent')?.imageGenerationModel).toBe('gpt-image-2')
      expect(settings.apiKey).toBe(POOL_KEY)
      expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 10, output_format: 'jpeg' }, settings)).toMatchObject({ n: 4, output_format: 'png' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('migrates the legacy local pool preset to the same-origin pool profile', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ shared_profiles: [
      { id: 'chat', name: 'Shared chat', role: 'chat', provider: 'openai', model: 'chat-model', enabled: true },
    ] }))
    vi.stubGlobal('fetch', fetcher)
    try {
      // 迁移时保留共享对话配置，由本用例明确准备，不依赖其它用例的缓存。
      await fetchSharedProfiles('test-session', 'https://pool.example')
      const legacySettings = normalizeSettings({
        ...DEFAULT_SETTINGS,
        activeProfileId: 'local-image-api',
        agentTextProfileId: 'local-image-api',
        agentImageProfileId: 'local-image-api',
        profiles: [
          ...DEFAULT_SETTINGS.profiles,
          {
            ...DEFAULT_SETTINGS.profiles[0],
            id: 'local-image-api',
            name: '本地测试 · 账号池生图',
            baseUrl: 'http://<old-server>:3000/v1',
            apiKey: 'local-proxy-placeholder',
            apiProxy: true,
          },
        ],
      })
      const settings = normalizeSettings({ ...legacySettings, ...poolSettings(legacySettings, 'https://pool.example') })
      const pool = settings.profiles.find((profile) => profile.id === POOL_PROFILE_ID)

      expect(settings.activeProfileId).toBe(POOL_PROFILE_ID)
      // 账号池 (Agent) 直接调本站账号：历史遗留的 local-image-api 会改落到它，开箱即用。
      expect(settings.agentTextProfileId).toBe(POOL_AGENT_PROFILE_ID)
      expect(settings.profiles.find((profile) => profile.id === 'shared-chat')).toMatchObject({ apiMode: 'responses' })
      expect(settings.agentImageProfileId).toBe(POOL_PROFILE_ID)
      expect(settings.profiles.some((profile) => profile.id === 'local-image-api')).toBe(false)
      // 账号池本身必须继续保留，供生图使用。
      expect(settings.profiles.some((profile) => profile.id === POOL_PROFILE_ID)).toBe(true)
      expect(settings.profiles.some((profile) => profile.id === 'chatgpt2api-pool-agent')).toBe(true)
      expect(pool).toMatchObject({ baseUrl: 'https://pool.example/v1', apiKey: POOL_KEY, apiProxy: false })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps a third-party image profile selected in agent mode', () => {
    const custom = { ...DEFAULT_SETTINGS.profiles[0], id: 'my-image-api', name: '我的生图配置', apiKey: 'third-party-key' }
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      agentApiConfigMode: 'hybrid',
      agentImageProfileId: custom.id,
      profiles: [...DEFAULT_SETTINGS.profiles, custom],
    })
    expect(normalizeSettings({ ...settings, ...poolSettings(settings, 'https://pool.example') }).agentImageProfileId).toBe(custom.id)
  })

  it('never leaves the removed legacy pool preset selected as a profile id', () => {
    // 回归：local-image-api 不在池里了，但若选中值还指着它，请求会带本站会话凭据打到 /api-proxy 并报错。
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      agentApiConfigMode: 'hybrid',
      agentTextProfileId: 'local-image-api',
      agentImageProfileId: 'local-image-api',
      profiles: DEFAULT_SETTINGS.profiles,
    })
    const pool = normalizeSettings({ ...settings, ...poolSettings(settings, 'https://pool.example') })
    expect(pool.agentTextProfileId).toBe(POOL_AGENT_PROFILE_ID)
    expect(pool.agentImageProfileId).toBe(POOL_PROFILE_ID)
  })

  it('injects a memory-only credential for same-origin API requests', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
    const request = poolFetch(fetcher, 'https://pool.example', () => 'session-secret')
    await request('https://pool.example/v1/images/generations', { method: 'POST', headers: { Authorization: `Bearer ${POOL_KEY}` }, body: '{}' })
    expect(new Headers(fetcher.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer session-secret')
    expect(fetcher.mock.calls[0][1].redirect).toBe('error')
  })

  it('refuses cross-origin and non-API credential forwarding', async () => {
    const fetcher = vi.fn()
    const request = poolFetch(fetcher, 'https://pool.example', () => 'session-secret')
    for (const url of ['https://other.example/v1/images/generations', 'https://pool.example/other']) {
      await expect(request(url, { headers: { Authorization: `Bearer ${POOL_KEY}` } })).rejects.toThrow('本站登录凭据')
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('leaves separately configured provider credentials unchanged', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
    const request = poolFetch(fetcher, 'https://pool.example', () => 'session-secret')
    const init = { headers: { Authorization: 'Bearer custom-key' } }
    await request('https://other.example/v1/images/generations', init)
    expect(fetcher).toHaveBeenCalledWith('https://other.example/v1/images/generations', init)
  })

  it('authorizes creative library reads through the workbench session', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
    const request = poolFetch(fetcher, 'https://pool.example', () => 'session-secret')
    const headers = { Authorization: `Bearer ${POOL_KEY}` }
    const list = '/api/creative?kind=style'
    const detail = '/api/creative/1a274a44-c633-4494-9599-cc37da5fd638'
    await request(list, { headers })
    await request(detail, { headers })
    expect(fetcher.mock.calls.map(([, init]) => new Headers(init.headers).get('Authorization')))
      .toEqual(['Bearer session-secret', 'Bearer session-secret'])
    await expect(request(detail, { headers, method: 'PUT' })).rejects.toThrow('本站登录凭据')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
