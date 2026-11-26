import type { ApiProfile, AppSettings } from '../types'
import { createDefaultFalProfile, createDefaultOpenAIProfile, normalizeSettings } from './apiProfiles'

// 账号池 profile ID 定义在 poolProfileIds.ts（叶子模块），避免 apiProfiles.ts ↔ accountPool.ts 循环依赖。
import { isPoolProfileId, LEGACY_LOCAL_POOL_PROFILE_ID, POOL_AGENT_PROFILE_ID, POOL_PROFILE_ID } from './poolProfileIds'
import { claimLegacyWorkbenchLocalStorage, normalizeWorkbenchOwner, setWorkbenchOwner } from './workbenchOwner'

export { isPoolProfileId, POOL_AGENT_PROFILE_ID, POOL_PROFILE_ID } from './poolProfileIds'

export const POOL_KEY = 'chatgpt2api-session'
export const isPoolBuild = import.meta.env.VITE_ACCOUNT_POOL === 'true'
/** 共享模型列表可能已更新（后台重试成功 / 外层页面通知）时广播，界面据此重读配置列表。 */
export const SHARED_PROFILES_SYNCED_EVENT = 'chatgpt2api:shared-profiles-synced'

export interface SharedProfileItem {
  id: string
  name: string
  role: 'chat' | 'image'
  provider: 'openai' | 'fal' | 'custom'
  base_url: string
  api_key: string
  model: string
  description?: string
  enabled: boolean
}

let cachedSharedProfiles: ApiProfile[] = []

export function convertSharedProfileToApiProfile(sp: SharedProfileItem): ApiProfile {
  const isChat = sp.role === 'chat'
  if (sp.provider === 'fal') {
    return createDefaultFalProfile({
      id: `shared-${sp.id}`,
      name: `[共享] ${sp.name}`,
      description: sp.description || (isChat ? '全站共享对话模型' : '全站共享生图模型'),
      baseUrl: sp.base_url || 'https://fal.run',
      apiKey: sp.api_key || '',
      model: sp.model || (isChat ? 'gpt-4o' : 'fal-ai/flux/schnell'),
      apiMode: isChat ? 'responses' : 'images',
      streamImages: false,
    })
  }

  return createDefaultOpenAIProfile({
    id: `shared-${sp.id}`,
    name: `[共享] ${sp.name}`,
    description: sp.description || (isChat ? '全站共享对话模型' : '全站共享生图模型'),
    baseUrl: sp.base_url || 'https://api.openai.com/v1',
    apiKey: sp.api_key || '',
    model: sp.model || (isChat ? 'gpt-4o' : 'dall-e-3'),
    imageGenerationModel: isChat ? undefined : (sp.model || 'dall-e-3'),
    apiMode: isChat ? 'responses' : 'images',
    // Shared image requests go through the same-origin restricted proxy. This
    // avoids browser CORS failures and lets the server return upstream errors.
    apiProxy: !isChat,
    streamImages: false,
  })
}

let currentSessionKey = ''

// 共享模型列表跟着会话走：普通用户登录后必须在任意时刻都能刷新到管理员刚发布/停用的共享模型。
// 因此这里改用注入的认证方式（本站 Bearer 令牌或父页面 session key），而不是写死登录 key。
type SharedProfilesAuth =
  | { kind: 'bearer'; token: string }
  | { kind: 'pool-session'; getKey: () => string }

let sharedProfilesAuth: SharedProfilesAuth | null = null

export function setSharedProfilesAuth(auth: SharedProfilesAuth | null): void {
  sharedProfilesAuth = auth
  currentSessionKey = ''
}

function resolveSharedProfilesToken(): string {
  if (!sharedProfilesAuth) return currentSessionKey
  if (sharedProfilesAuth.kind === 'bearer') return sharedProfilesAuth.token
  return sharedProfilesAuth.getKey() || currentSessionKey
}

/**
 * 拉取共享模型列表。返回是否真的拿到了服务端列表：
 * 网络 failure / 非 2xx / 响应结构异常都返回 false，调用方据此重试，
 * 避免把一次瞬时失败当成「本站没有共享模型」固化到配置里。
 */
export async function fetchSharedProfiles(token: string, origin: string): Promise<boolean> {
  currentSessionKey = token
  try {
    const res = await fetch(`${origin}/api/shared-profiles`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!res.ok) return false
    const data = await res.json()
    if (!Array.isArray(data.shared_profiles)) return false
    cachedSharedProfiles = data.shared_profiles
      .filter((sp: SharedProfileItem) => sp.enabled !== false)
      .map(convertSharedProfileToApiProfile)
    return true
  } catch (err) {
    console.warn('Failed to fetch shared profiles', err)
    return false
  }
}

/**
 * 拉取共享模型并重建配置列表。返回是否真的拿到了列表：
 * 未登录 / 请求失败时为 false，调用方据此重试，避免把空列表当成「没有共享模型」写进配置。
 */
// 非浏览器环境（单元测试）没有 window：跳过事件广播。
function getSharedProfilesWindow(): Window | null {
  return typeof window === 'undefined' ? null : window
}

export async function refreshSharedProfiles(origin = getSharedProfilesWindow()?.location.origin ?? ''): Promise<boolean> {
  // 优先使用注入的会话认证（本站登录令牌 / 父页面 session key），没有时才退回旧逻辑。
  const token = resolveSharedProfilesToken()
  if (!token) return false
  const fetched = await fetchSharedProfiles(token, origin)
  // 拉取失败时不能把（可能为空的）缓存写进配置并宣告成功：返回 false 让调用方按退避重试。
  if (!fetched) return false
  try {
    const { useStore } = await import('../store')
    const currentSettings = useStore.getState().settings
    useStore.getState().setSettings(poolSettings(currentSettings, origin))
    getSharedProfilesWindow()?.dispatchEvent(new Event(SHARED_PROFILES_SYNCED_EVENT))
    return true
  } catch (err) {
    console.warn('Failed to update store with shared profiles', err)
    return false
  }
}

// 启动阶段 iframe 与外层页面的握手有先后顺序：登录密钥可能比首帧渲染更晚到位。
// 首帧渲染时若还没拿到共享模型列表，就按退避间隔重试，直到成功或超时。
let bootstrapRetryTimer: ReturnType<typeof setTimeout> | null = null

/** 当前是否有正在拉取或已排期重试的共享模型请求（界面据此判断要不要继续等）。 */
export function isSharedProfilesSyncPending(): boolean {
  return bootstrapRetryTimer !== null
}

function scheduleSharedProfilesRetry(delay: number, attempt: number, origin?: string): void {
  bootstrapRetryTimer = setTimeout(() => {
    bootstrapRetryTimer = null
    // 通知界面：重试可能终于拿到了共享模型，需要重建配置列表后重渲染。
    getSharedProfilesWindow()?.dispatchEvent(new Event(SHARED_PROFILES_SYNCED_EVENT))
    void ensureSharedProfilesLoaded(attempt, origin)
  }, delay)
}

export function ensureSharedProfilesLoaded(attempt = 0, origin?: string): Promise<void> {
  if (bootstrapRetryTimer !== null || attempt > 20) return Promise.resolve()
  return refreshSharedProfiles(origin).then((ok) => {
    if (!ok) scheduleSharedProfilesRetry(Math.min(1500, 200 + attempt * 100), attempt + 1, origin)
  })
}

export function poolSettings(settings: AppSettings, origin: string): Partial<AppSettings> {
  const existing = settings.profiles.find((profile) => profile.id === POOL_PROFILE_ID)
  const existingAgent = settings.profiles.find((profile) => profile.id === POOL_AGENT_PROFILE_ID)
  // 一个选中值可沿用，当且仅当它指向仍然存在、且不是池内配置的 profile。
  // default-openai 是内置空白配置（未填密钥的占位），从未被用户主动选中，视为「没选过」。
  // 历史遗留的 local-image-api 已不在列表里，用本站凭据请求时必然报「本站登录凭据只能用于本站 API」，
  // 因此它以及其它无效值都必须改落到正式账号池。
  const isUserChoice = (id: string | null | undefined): id is string =>
    Boolean(id) && id !== 'default-openai' && !isPoolProfileId(id as string)
    && settings.profiles.some((item) => item.id === id)
  const poolSelectedActiveProfileId = isUserChoice(settings.activeProfileId) ? settings.activeProfileId : POOL_PROFILE_ID
  // 对话模型：池内配置（含历史的 local-image-api）统一落到账号池 (Agent)，第三方 Responses 配置保留。
  const poolSelectedTextProfileId = isUserChoice(settings.agentTextProfileId) ? settings.agentTextProfileId : POOL_AGENT_PROFILE_ID
  const poolSelectedImageProfileId = isUserChoice(settings.agentImageProfileId) ? settings.agentImageProfileId : POOL_PROFILE_ID
  const profile = createDefaultOpenAIProfile({
    ...existing,
    id: POOL_PROFILE_ID,
    name: '本站账号池',
    description: '使用当前登录账号。支持文生图、参考图和局部编辑；单次最多 4 张。',
    baseUrl: `${origin}/v1`,
    apiKey: POOL_KEY,
    model: existing?.model || 'gpt-image-2',
    imageGenerationModel: existing?.imageGenerationModel || 'gpt-image-2',
    apiMode: 'images',
    apiProxy: false,
    codexCli: false,
    responseFormatB64Json: true,
    streamImages: false,
    transparentBackgroundMethod: 'local',
  })
  const agentProfile = createDefaultOpenAIProfile({
    ...existingAgent,
    id: POOL_AGENT_PROFILE_ID,
    name: '本站账号池 (Agent)',
    description: '使用当前登录账号。支持智能对话、联网搜索与生图工作流。',
    baseUrl: `${origin}/v1`,
    apiKey: POOL_KEY,
    model: 'auto',
    imageGenerationModel: existingAgent?.imageGenerationModel || 'gpt-image-2',
    apiMode: 'responses',
    apiProxy: false,
    codexCli: false,
    streamImages: true,
  })
  const sharedProfiles = [...cachedSharedProfiles]
  // 只有拿到过共享模型列表后，才隐藏没填密钥的默认配置：
  // 否则共享模型明明存在，用户却看到列表里空空如也（与管理员视角不一致）。
  const dropDefaultProfile = sharedProfiles.length > 0 && !isPoolBuild
  const nextProfiles = [
    profile,
    agentProfile,
    ...sharedProfiles,
    ...settings.profiles.filter(
      (item) => !isPoolProfileId(item.id)
        && !item.id.startsWith('shared-')
        && (item.id !== 'default-openai' || item.apiKey || !dropDefaultProfile)
    ),
  ]
  const activeProfileId = nextProfiles.some((item) => item.id === poolSelectedActiveProfileId)
    ? poolSelectedActiveProfileId
    : profile.id
  return {
    // 同步返回 activeProfileId / baseUrl / model 等派生字段，调用方直接合并即可得到一致的配置；
    // 只给 profiles + 选中 id 时，normalizeSettings 会用 profiles[0] 兜底，界面与请求会各用一套。
    ...normalizeSettings({
      ...settings,
      profiles: nextProfiles,
      activeProfileId,
      // 没选过（off）时用混合模式：本站账号池 (Agent) 对话 + 本站账号池生图。
      agentApiConfigMode: settings.agentApiConfigMode && settings.agentApiConfigMode !== 'off' ? settings.agentApiConfigMode : 'hybrid',
      // 账号池 (Agent) 是本站自己的对话能力：后端 /v1/responses 用登录身份调用账号池里的 ChatGPT 账号。
      agentTextProfileId: poolSelectedTextProfileId,
      agentImageProfileId: poolSelectedImageProfileId,
    }),
  }
}

// 登录密钥只留在内存，不写入画廊配置、历史记录或分享链接。
export function poolFetch(fetcher: typeof fetch, origin: string, getKey: () => string): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (headers.get('Authorization') !== `Bearer ${POOL_KEY}`) return fetcher(input, init)
    const url = new URL(input instanceof Request ? input.url : String(input), origin)
    if (url.origin !== origin || !url.pathname.startsWith('/v1/')) {
      throw new Error('本站登录凭据只能用于本站 API，请为其他服务单独填写密钥。')
    }
    const key = getKey()
    if (!key) throw new Error('登录已失效，请重新登录。')
    headers.set('Authorization', `Bearer ${key}`)
    return fetcher(input, { ...init, headers, redirect: 'error' })
  }
}

export function connectAccountPool(): Promise<void> {
  if (window.parent === window) {
    window.location.replace('/image/')
    return new Promise(() => {})
  }
  // 会话 key 由父页面通过 postMessage 下发，这里把认证方式交给共享模型刷新逻辑；
  // 父页面若在登录 key 到位前就请求刷新，会先得到空 key 并直接跳过，不会带着占位符发请求。
  let key = ''
  setSharedProfilesAuth({ kind: 'pool-session', getKey: () => key })
  return new Promise((resolve) => {
    window.fetch = poolFetch(window.fetch.bind(window), window.location.origin, () => key)
    const ready = () => window.parent.postMessage({ type: 'account-pool-ready' }, window.location.origin)
    const timer = window.setInterval(ready, 500)
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      if (
        event.data?.type === 'sync-shared-profiles' ||
        event.data?.type === 'sync-stored-settings'
      ) {
        void refreshSharedProfiles(window.location.origin)
        return
      }
      if (event.data?.type !== 'account-pool-session' || typeof event.data.key !== 'string' || !event.data.key) return
      const nextOwner = normalizeWorkbenchOwner(event.data.owner)
      if (nextOwner) {
        setWorkbenchOwner(nextOwner)
        claimLegacyWorkbenchLocalStorage(nextOwner)
      }
      if (event.data.key === key) return
      const hadSession = Boolean(key)
      key = event.data.key
      currentSessionKey = key
      window.clearInterval(timer)
      // 共享配置可在工作台挂载后加载，避免慢请求阻塞首屏。
      resolve()
      if (hadSession) void refreshSharedProfiles(window.location.origin)
    }
    window.addEventListener('message', receive)
    window.addEventListener('focus', () => {
      void refreshSharedProfiles(window.location.origin)
    })
    ready()
  })
}
