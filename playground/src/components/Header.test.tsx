// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
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

afterEach(() => { state.appMode = 'agent'; vi.clearAllMocks() })

it('keeps pool Agent history and new conversation accessible even when the mobile header is hidden', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<Header />))
    const history = container.querySelector<HTMLButtonElement>('[aria-label="历史会话"]')!
    const create = container.querySelector<HTMLButtonElement>('[aria-label="新建会话"]')!
    expect(history).not.toBeNull()
    expect(create).not.toBeNull()
    expect(container.textContent).toContain('旧会话')
    await act(async () => history.click())
    expect(container.textContent).toContain('历史会话列表')
    await act(async () => create.click())
    expect(state.createAgentConversation).toHaveBeenCalledOnce()
  } finally { await act(async () => root.unmount()); container.remove() }
})

it('does not add a duplicate mode navigation to the embedded gallery', async () => {
  state.appMode = 'gallery'
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<Header />))
    expect(container.childElementCount).toBe(0)
  } finally { await act(async () => root.unmount()) }
})
