import { createFalClient } from '@fal-ai/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultFalProfile, DEFAULT_FAL_BASE_URL, DEFAULT_SETTINGS } from './apiProfiles'
import { callFalAiImageApi } from './falAiImageApi'

vi.mock('@fal-ai/client', () => ({ createFalClient: vi.fn() }))

const queue = {
  submit: vi.fn(),
  subscribeToStatus: vi.fn(),
  result: vi.fn(),
  cancel: vi.fn(),
}

describe('callFalAiImageApi', () => {
  beforeEach(() => {
    vi.mocked(createFalClient).mockReturnValue({ queue } as unknown as ReturnType<typeof createFalClient>)
    queue.submit.mockResolvedValue({ request_id: 'req-1' })
    queue.subscribeToStatus.mockResolvedValue({ status: 'COMPLETED' })
    queue.cancel.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('aborts the wait and requests cancellation of an enqueued job', async () => {
    const controller = new AbortController()
    queue.subscribeToStatus.mockImplementation(async (_endpoint, { abortSignal }) => {
      controller.abort()
      abortSignal.throwIfAborted()
    })
    await expect(callFalAiImageApi({
      settings: DEFAULT_SETTINGS,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      signal: controller.signal,
    }, createDefaultFalProfile({ apiKey: 'fal-key' }))).rejects.toMatchObject({ name: 'AbortError' })
    expect(queue.cancel).toHaveBeenCalledWith('openai/gpt-image-2', { requestId: 'req-1' })
    expect(queue.result).not.toHaveBeenCalled()
  })

  it('uses the default fal endpoint without proxyUrl', async () => {
    queue.result.mockResolvedValue({
      requestId: 'req-1',
      data: { images: [{ b64_json: 'aW1hZ2U=' }] },
    })

    await callFalAiImageApi({
      settings: DEFAULT_SETTINGS,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    }, createDefaultFalProfile({ apiKey: 'fal-key', baseUrl: DEFAULT_FAL_BASE_URL }))

    expect(createFalClient).toHaveBeenCalledWith({
      credentials: 'fal-key',
      suppressLocalCredentialsWarning: true,
    })
  })

  it('passes custom fal API URL to the SDK proxyUrl option', async () => {
    queue.result.mockResolvedValue({
      requestId: 'req-1',
      data: { images: [{ b64_json: 'aW1hZ2U=' }] },
    })

    await callFalAiImageApi({
      settings: DEFAULT_SETTINGS,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    }, createDefaultFalProfile({
      apiKey: 'fal-key',
      baseUrl: 'https://fal-proxy.example.com/api/fal/',
    }))

    expect(createFalClient).toHaveBeenCalledWith({
      credentials: 'fal-key',
      suppressLocalCredentialsWarning: true,
      proxyUrl: 'https://fal-proxy.example.com/api/fal',
    })
  })

  it('uses the GPT Image 2.5 text-to-image endpoint and preserves max quality', async () => {
    queue.result.mockResolvedValue({
      requestId: 'req-1',
      data: { images: [{ b64_json: 'aW1hZ2U=' }] },
    })

    await callFalAiImageApi({
      settings: DEFAULT_SETTINGS,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, quality: 'max' },
      inputImageDataUrls: [],
    }, createDefaultFalProfile({ model: 'openai/gpt-image-2.5/sunburst', apiKey: 'fal-key' }))

    expect(queue.submit).toHaveBeenCalledWith('openai/gpt-image-2.5/sunburst/text-to-image', expect.objectContaining({
      input: expect.objectContaining({ quality: 'max' }),
    }))
  })

  it('uses the GPT Image 2.5 edit endpoint', async () => {
    queue.result.mockResolvedValue({
      requestId: 'req-1',
      data: { images: [{ b64_json: 'aW1hZ2U=' }] },
    })

    await callFalAiImageApi({
      settings: DEFAULT_SETTINGS,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: ['data:image/png;base64,aW1hZ2U='],
    }, createDefaultFalProfile({ model: 'openai/gpt-image-2.5/flare', apiKey: 'fal-key' }))

    expect(queue.submit).toHaveBeenCalledWith('openai/gpt-image-2.5/flare/edit', expect.anything())
  })

  it('requests a native transparent background', async () => {
    queue.result.mockResolvedValue({
      requestId: 'req-1',
      data: { images: [{ b64_json: 'aW1hZ2U=' }] },
    })

    await callFalAiImageApi({
      settings: DEFAULT_SETTINGS,
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, output_format: 'webp', transparent_output: true },
      nativeTransparentBackground: true,
      inputImageDataUrls: [],
    }, createDefaultFalProfile({ apiKey: 'fal-key' }))

    expect(queue.submit).toHaveBeenCalledWith('openai/gpt-image-2', expect.objectContaining({
      input: expect.objectContaining({ background: 'transparent' }),
    }))
  })

})
