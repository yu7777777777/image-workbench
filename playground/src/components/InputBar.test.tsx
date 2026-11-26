// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useStore } from '../store'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } from '../lib/apiProfiles'
import InputBar from './InputBar'

vi.mock('../lib/accountPool', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/accountPool')>(),
  isPoolBuild: true,
  ensureSharedProfilesLoaded: vi.fn().mockResolvedValue(false),
}))
vi.mock('../lib/quota', () => ({ fetchQuotaData: vi.fn().mockResolvedValue(null) }))
vi.mock('../lib/modelsCatalog', () => ({
  fetchAvailableImageModels: vi.fn().mockResolvedValue(['gpt-image-2']),
  fetchAvailableImageModelsResult: vi.fn().mockResolvedValue({ ok: true, models: ['gpt-image-2'] }),
  getCachedAvailableImageModels: vi.fn().mockReturnValue(['gpt-image-2']),
  filterHiddenImageModels: (models: string[]) => models,
}))
// 参数面板不参与历史入口交互，避免它的模型目录影响本用例。
vi.mock('./input/inputParamsPanel', () => ({ default: () => null }))

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  useStore.setState({
    ...useStore.getInitialState(),
    appMode: 'agent',
    agentMobileHeaderVisible: false,
    settings: normalizeSettings({
      ...DEFAULT_SETTINGS,
      agentApiConfigMode: 'single',
      profiles: [createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' })],
    }),
  })
  useStore.getState().createAgentConversation()
  useStore.setState({ agentConversations: useStore.getState().agentConversations.map((conversation) => ({
    ...conversation,
    title: '旧会话',
    messages: [{ id: 'message-one', role: 'user', content: '已发送的消息', roundId: 'round-one', createdAt: 1 }],
  })) })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it.each([390, 1280])('keeps Agent history and new conversation usable without the header at width %s', async (width) => {
  vi.stubGlobal('innerWidth', width)
  const previousId = useStore.getState().activeAgentConversationId
  await act(async () => root.render(<InputBar />))
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
  const history = buttons.find((button) => button.textContent?.includes('对话历史'))!
  const create = buttons.find((button) => button.textContent?.includes('新建对话'))!
  expect(history).toBeDefined()
  expect(create).toBeDefined()
  expect(history.getAttribute('aria-expanded')).toBe('false')
  await act(async () => history.click())
  expect(history.getAttribute('aria-expanded')).toBe('true')
  expect(document.body.textContent).toContain('旧会话')
  await act(async () => create.click())
  expect(history.getAttribute('aria-expanded')).toBe('false')
  expect(useStore.getState().agentConversations).toHaveLength(2)
  expect(useStore.getState().activeAgentConversationId).not.toBe(previousId)
})
