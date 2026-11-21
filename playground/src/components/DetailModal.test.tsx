// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import DetailModal from './DetailModal'

const state = vi.hoisted(() => ({
  tasks: [] as TaskRecord[],
  detailTaskId: 'portrait-task',
  settings: { codexCli: false },
  dismissedCodexCliPrompts: [] as string[],
  streamPreviews: {} as Record<string, string>,
  streamPreviewSlots: {},
  setDetailTaskId: vi.fn(),
  setLightboxImageId: vi.fn(),
  setConfirmDialog: vi.fn(),
  showToast: vi.fn(),
  openFavoritePicker: vi.fn(),
}))

vi.mock('../store', () => ({
  useStore: (selector: (value: typeof state) => unknown) => selector(state),
  getCodexCliPromptKey: () => 'test',
  reuseConfig: vi.fn(),
  editOutputs: vi.fn(),
  removeTask: vi.fn(),
  removeTaskOutput: vi.fn(),
  showCodexCliPrompt: vi.fn(),
  retryTask: vi.fn(),
  submitTask: vi.fn(),
}))
vi.mock('./GalleryAnnotatorHost', () => ({ openGalleryAnnotator: vi.fn() }))
vi.mock('../lib/imageCache', () => ({
  getCachedImage: (id: string) => `blob:test-${id}`,
  ensureImageCached: vi.fn(),
  ensureImageDimensionsCached: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../lib/downloadImages', () => ({
  downloadImageIds: vi.fn().mockResolvedValue({ successCount: 1 }),
  downloadImageEntriesAsZip: vi.fn(),
  getImageZipEntries: vi.fn(),
}))

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  state.tasks = [{
    id: 'portrait-task',
    prompt: '竖幅图片提示词'.repeat(200),
    params: { ...DEFAULT_PARAMS, size: '1024x1536', n: 2 },
    inputImageIds: [],
    outputImages: ['portrait', 'landscape'],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: null,
  }]
  state.streamPreviews = {}
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  // React 的 act 环境标记只影响测试，不修改应用代码。
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

it('为桌面提供视口尺寸、全高图片区及独立滚动的参数栏，并约束移动端', async () => {
  await act(async () => root.render(<DetailModal />))
  const overlay = container.firstElementChild!
  const modal = overlay.children[1]
  const [header, preview, details] = Array.from(modal.children)
  expect(modal.classList.contains('w-[94vw]')).toBe(true)
  expect(modal.classList.contains('max-w-full')).toBe(true)
  expect(modal.classList.contains('h-[min(94dvh,calc(100dvh-2rem))]')).toBe(true)
  expect(modal.classList.contains('max-w-4xl')).toBe(false)
  expect(modal.classList.contains('overflow-hidden')).toBe(true)
  expect(modal.classList.contains('flex-col')).toBe(true)
  expect(modal.classList.contains('md:flex-row')).toBe(true)
  expect(header.classList.contains('shrink-0')).toBe(true)
  expect(preview.classList.contains('md:h-full')).toBe(true)
  expect(preview.classList.contains('md:flex-1')).toBe(true)
  expect(preview.classList.contains('min-w-0')).toBe(true)
  expect(preview.classList.contains('h-[min(40dvh,20rem)]')).toBe(true)
  for (const name of ['md:w-96', 'xl:w-[28rem]', 'min-h-0', 'flex-1', 'md:flex-none', 'overflow-y-auto', 'overscroll-contain']) {
    expect(details.classList.contains(name)).toBe(true)
  }
  const actions = details.lastElementChild!
  expect(actions.classList.contains('sm:flex-wrap')).toBe(true)
  expect(actions.classList.contains('shrink-0')).toBe(true)
})

it('完成图与流式预览均在可用宽高内等比包含，不裁剪或拉伸', async () => {
  await act(async () => root.render(<DetailModal />))
  const output = container.querySelector<HTMLImageElement>('img[data-image-id="portrait"]')!
  for (const name of ['w-[calc(100%-2rem)]', 'h-[calc(100%-2rem)]', 'object-contain']) {
    expect(output.classList.contains(name)).toBe(true)
  }
  state.tasks = [{ ...state.tasks[0], status: 'running', outputImages: [] }]
  state.streamPreviews = { 'portrait-task': 'data:image/png;base64,preview' }
  await act(async () => root.render(<DetailModal />))
  const preview = container.querySelector<HTMLImageElement>('img')!
  expect(preview.getAttribute('src')).toBe('data:image/png;base64,preview')
  for (const name of ['w-[calc(100%-2rem)]', 'h-[calc(100%-2rem)]', 'object-contain']) {
    expect(preview.classList.contains(name)).toBe(true)
  }
})

it('保留图片切换、灯箱、下载、标注、编辑、复用及关闭交互', async () => {
  const store = await import('../store')
  const { openGalleryAnnotator } = await import('./GalleryAnnotatorHost')
  const { downloadImageIds } = await import('../lib/downloadImages')
  await act(async () => root.render(<DetailModal />))
  const click = async (selector: string) => {
    const button = container.querySelector<HTMLElement>(selector)!
    expect(button).not.toBeNull()
    await act(async () => button.click())
  }
  await click('button.right-2')
  expect(container.querySelector('img[data-image-id="landscape"]')).not.toBeNull()
  await click('button.left-2')
  await click('img[data-image-id="portrait"]')
  expect(state.setLightboxImageId).toHaveBeenCalledWith('portrait', ['portrait', 'landscape'])
  await click('[aria-label="下载图片"]')
  expect(downloadImageIds).toHaveBeenCalledWith(['portrait'], 'task-portrait-task')
  expect(state.setDetailTaskId).not.toHaveBeenCalled()
  const actions = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
  await act(async () => actions.find((button) => button.textContent?.includes('标注图片'))!.click())
  expect(openGalleryAnnotator).toHaveBeenCalledWith({ imageId: 'portrait', taskId: 'portrait-task' })
  await act(async () => actions.find((button) => button.textContent?.includes('编辑输出'))!.click())
  expect(store.editOutputs).toHaveBeenCalledWith(state.tasks[0])
  await act(async () => actions.find((button) => button.textContent?.includes('复用配置'))!.click())
  expect(store.reuseConfig).toHaveBeenCalledWith(state.tasks[0])
  for (const close of container.querySelectorAll<HTMLButtonElement>('[aria-label="关闭"]')) {
    await act(async () => close.click())
  }
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  await act(async () => (container.firstElementChild as HTMLElement).click())
  expect(state.setDetailTaskId).toHaveBeenLastCalledWith(null)
  expect(state.setDetailTaskId).toHaveBeenCalledTimes(6)
})
