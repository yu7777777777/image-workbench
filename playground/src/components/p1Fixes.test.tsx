// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Select from './Select'
import SizePickerModal from './SizePickerModal'
import Toast from './Toast'
import AgentWorkspace, { resetAgentScrollMemoryForTests } from './AgentWorkspace'
import { useStore } from '../store'

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  resetAgentScrollMemoryForTests()
  useStore.setState({ ...useStore.getInitialState() })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('P1 UX and Escape dismissal fixes', () => {
  it('closes Select dropdown on Escape', async () => {
    await act(async () => {
      root.render(
        <Select
          value="all"
          onChange={vi.fn()}
          options={[
            { label: '全部', value: 'all' },
            { label: '已完成', value: 'done' },
          ]}
        />,
      )
    })

    const trigger = container.querySelector<HTMLElement>('[role="button"], button, .cursor-pointer')!
    await act(async () => {
      trigger.click()
    })
    expect(document.body.textContent).toContain('已完成')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.body.textContent).not.toContain('已完成')
  })

  it('closes SizePickerModal on Escape and localizes auto size display', async () => {
    const onClose = vi.fn()
    await act(async () => {
      root.render(
        <SizePickerModal
          currentSize="auto"
          onSelect={vi.fn()}
          onClose={onClose}
        />,
      )
    })

    expect(container.textContent).toContain('当前：自动')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('positions Toast at top with high z-index in canvas mode and at bottom in gallery mode', async () => {
    useStore.setState({
      appMode: 'canvas',
      toast: { message: '正在使用 AI 润色提示词…', type: 'info' },
    })
    await act(async () => {
      root.render(<Toast />)
    })
    const canvasToast = container.firstElementChild as HTMLElement
    expect(canvasToast.className).toContain('top-5')
    expect(canvasToast.className).toContain('z-[30000]')

    await act(async () => {
      useStore.setState({ appMode: 'gallery' })
    })
    const galleryToast = container.firstElementChild as HTMLElement
    expect(galleryToast.className).toContain('bottom-24')
  })

  it('shows waiting status text in Agent while streaming empty assistant placeholder and auto-scrolls on new round', async () => {
    const scrollToMock = vi.fn()
    useStore.setState({
      appMode: 'agent',
      agentConversationsLoaded: true,
      activeAgentConversationId: 'conv-1',
      agentConversations: [{
        id: 'conv-1',
        title: '测试对话',
        activeRoundId: 'round-1',
        createdAt: 1,
        updatedAt: 1,
        rounds: [{
          id: 'round-1',
          index: 1,
          parentRoundId: null,
          userMessageId: 'u1',
          assistantMessageId: 'a1',
          prompt: '第一轮',
          inputImageIds: [],
          outputTaskIds: [],
          status: 'running',
          error: null,
          createdAt: 1,
          finishedAt: null,
        }],
        messages: [
          { id: 'u1', role: 'user', content: '第一轮', roundId: 'round-1', createdAt: 1 },
          { id: 'a1', role: 'assistant', content: '', roundId: 'round-1', createdAt: 2 },
        ],
      }],
    })

    await act(async () => {
      root.render(<AgentWorkspace />)
    })

    expect(container.textContent).toContain('正在思考与准备回复…')

    const scrollContainer = container.querySelector<HTMLDivElement>('.studio-agent-content')!
    scrollContainer.scrollTo = scrollToMock
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1200, configurable: true })
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 400, configurable: true })

    await act(async () => {
      useStore.setState({
        agentConversations: [{
          id: 'conv-1',
          title: '测试对话',
          activeRoundId: 'round-2',
          createdAt: 1,
          updatedAt: 3,
          rounds: [
            {
              id: 'round-1',
              index: 1,
              parentRoundId: null,
              userMessageId: 'u1',
              assistantMessageId: 'a1',
              prompt: '第一轮',
              inputImageIds: [],
              outputTaskIds: [],
              status: 'done',
              error: null,
              createdAt: 1,
              finishedAt: 2,
            },
            {
              id: 'round-2',
              index: 2,
              parentRoundId: 'round-1',
              userMessageId: 'u2',
              assistantMessageId: 'a2',
              prompt: '第二轮',
              inputImageIds: [],
              outputTaskIds: [],
              status: 'running',
              error: null,
              createdAt: 3,
              finishedAt: null,
            },
          ],
          messages: [
            { id: 'u1', role: 'user', content: '第一轮', roundId: 'round-1', createdAt: 1 },
            { id: 'a1', role: 'assistant', content: '第一轮回复', roundId: 'round-1', createdAt: 2 },
            { id: 'u2', role: 'user', content: '第二轮', roundId: 'round-2', createdAt: 3 },
            { id: 'a2', role: 'assistant', content: '', roundId: 'round-2', createdAt: 4 },
          ],
        }],
      })
    })

    expect(scrollToMock).toHaveBeenCalledWith({ top: 1200, behavior: 'smooth' })
  })
})
