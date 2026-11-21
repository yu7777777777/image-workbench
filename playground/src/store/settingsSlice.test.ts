import { beforeEach, describe, expect, it } from 'vitest'
import { create, type StateCreator } from 'zustand'
import { createSettingsSlice, type SettingsSlice } from './settingsSlice'
import type { AppState } from '../store'

function createTestStore(initialState?: Partial<AppState>) {
  return create<AppState>()((set, get, api) => ({
    ...(createSettingsSlice as unknown as StateCreator<AppState>)(set, get, api),
    tasks: [],
    reusedTaskApiProfileId: null,
    reusedTaskApiProfileName: null,
    reusedTaskApiProfileMissing: false,
    ...initialState,
  } as unknown as AppState))
}

describe('Settings Slice', () => {
  let store: ReturnType<typeof createTestStore>

  beforeEach(() => {
    store = createTestStore()
  })

  it('has expected initial state', () => {
    const state = store.getState()
    expect(state.settings).toBeDefined()
    expect(state.previousPresetConfig).toBeNull()
    expect(state.dismissedPresetProfileIds).toEqual([])
    expect(state.dismissedPresetProviderIds).toEqual([])
    expect(state.dismissedCodexCliPrompts).toEqual([])
  })

  it('dismisses and restores preset profiles', () => {
    store.getState().dismissPresetProfile('preset-1')
    expect(store.getState().dismissedPresetProfileIds).toEqual(['preset-1'])

    // No duplicate
    store.getState().dismissPresetProfile('preset-1')
    expect(store.getState().dismissedPresetProfileIds).toEqual(['preset-1'])

    store.getState().dismissPresetProfile('preset-2')
    expect(store.getState().dismissedPresetProfileIds).toEqual(['preset-1', 'preset-2'])

    store.getState().restorePresetProfile('preset-1')
    expect(store.getState().dismissedPresetProfileIds).toEqual(['preset-2'])
  })

  it('dismisses and restores preset providers', () => {
    store.getState().dismissPresetProvider('provider-1')
    expect(store.getState().dismissedPresetProviderIds).toEqual(['provider-1'])

    // No duplicate
    store.getState().dismissPresetProvider('provider-1')
    expect(store.getState().dismissedPresetProviderIds).toEqual(['provider-1'])

    store.getState().restorePresetProvider('provider-1')
    expect(store.getState().dismissedPresetProviderIds).toEqual([])
  })

  it('dismisses codex cli prompts', () => {
    store.getState().dismissCodexCliPrompt('feature-a')
    expect(store.getState().dismissedCodexCliPrompts).toEqual(['feature-a'])

    store.getState().dismissCodexCliPrompt('feature-a')
    expect(store.getState().dismissedCodexCliPrompts).toEqual(['feature-a'])

    store.getState().dismissCodexCliPrompt('feature-b')
    expect(store.getState().dismissedCodexCliPrompts).toEqual(['feature-a', 'feature-b'])
  })

  it('updates settings with setSettings', () => {
    store.getState().setSettings({ agentApiConfigMode: 'hybrid' })
    expect(store.getState().settings.agentApiConfigMode).toBe('hybrid')
  })

  it('updates settings via setPresetImportedSettings', async () => {
    const imported = {
      theme: 'dark' as const,
      profiles: [],
    }
    await store.getState().setPresetImportedSettings(imported)
    expect(store.getState().settings).toBeDefined()
  })
})
