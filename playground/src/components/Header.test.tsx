// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Header from './Header'

const state = vi.hoisted(() => ({
  appMode: 'agent', agentMobileHeaderVisible: false,
  agentConversations: [{ id: 'one', title: '旧会话' }], activeAgentConversationId: 'one',
  activeFavoriteCollectionId: null, createAgentConversation: vi.fn(),
  settings: { profiles: [], agentTextProfileId: '' }, setSettings: vi.fn(), setAppMode: vi.fn(),
}))
vi.mock('../store', () => ({ useStore: (selector: (value: typeof state) => unknown) => selector(state) }))
vi.mock('../lib/accountPool', () => ({ isPoolBuild: true, POOL_AGENT_PROFILE_ID: 'chatgpt2api-pool-agent' }))
vi.mock('./FavoriteCollections', () => ({ useFavoriteCollectionTitle: () => '' }))
vi.mock('./HistoryModal', () => ({ default: () => <div>历史会话列表</div> }))

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(() => { state.appMode = 'agent'; vi.clearAllMocks(); vi.unstubAllGlobals() })

it.each(['gallery', 'agent', 'canvas'])('does not add a duplicate header to the embedded %s mode', async (mode) => {
  state.appMode = mode
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<Header />))
    expect(container.childElementCount).toBe(0)
  } finally { await act(async () => root.unmount()) }
})
