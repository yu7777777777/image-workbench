import type { StateCreator } from 'zustand'
import type { AppSettings } from '../types'
import {
  DEFAULT_SETTINGS,
  mergePresetImportedSettings,
  normalizeSettings,
} from '../lib/apiProfiles'
import {
  enforcePresetConfigPolicy,
  getPresetConfig,
  getPresetProfileIds,
  getPresetProviderIds,
  isPresetConfigDeletionPrevented,
  isPresetConfigParamsLocked,
  isPresetProviderDeletionPrevented,
} from '../lib/presetConfig'
import type { AppState } from '../store'

export interface SettingsSlice {
  // 设置 State
  settings: AppSettings
  previousPresetConfig: Pick<AppSettings, 'customProviders' | 'profiles'> | null
  dismissedPresetProfileIds: string[]
  dismissedPresetProviderIds: string[]
  dismissedCodexCliPrompts: string[]

  // 设置 Actions
  setSettings: (s: Partial<AppSettings>) => void
  setPresetImportedSettings: (
    importedSettings: Partial<AppSettings> | unknown,
    transform?: (settings: AppSettings) => Partial<AppSettings>,
  ) => Promise<void>
  dismissPresetProfile: (id: string) => void
  restorePresetProfile: (id: string) => void
  dismissPresetProvider: (id: string) => void
  restorePresetProvider: (id: string) => void
  dismissCodexCliPrompt: (key: string) => void
}

export const createSettingsSlice: StateCreator<AppState, [], [], SettingsSlice> = (set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  previousPresetConfig: null,
  dismissedPresetProfileIds: [],
  dismissPresetProfile: (id) => set((state) => ({
    dismissedPresetProfileIds: state.dismissedPresetProfileIds.includes(id)
      ? state.dismissedPresetProfileIds
      : [...state.dismissedPresetProfileIds, id],
  })),
  restorePresetProfile: (id) => set((state) => ({
    dismissedPresetProfileIds: state.dismissedPresetProfileIds.filter((item) => item !== id),
  })),
  dismissedPresetProviderIds: [],
  dismissPresetProvider: (id) => set((state) => ({
    dismissedPresetProviderIds: state.dismissedPresetProviderIds.includes(id)
      ? state.dismissedPresetProviderIds
      : [...state.dismissedPresetProviderIds, id],
  })),
  restorePresetProvider: (id) => set((state) => ({
    dismissedPresetProviderIds: state.dismissedPresetProviderIds.filter((item) => item !== id),
  })),
  setSettings: (s) => set((st) => {
    const previous = normalizeSettings(st.settings)
    const incoming = s as Partial<AppSettings>
    const hasLegacyOverrides =
      incoming.baseUrl !== undefined ||
      incoming.apiKey !== undefined ||
      incoming.model !== undefined ||
      incoming.timeout !== undefined ||
      incoming.apiMode !== undefined ||
      incoming.codexCli !== undefined ||
      incoming.apiProxy !== undefined ||
      incoming.streamImages !== undefined ||
      incoming.streamPartialImages !== undefined
    const merged = normalizeSettings({ ...previous, ...incoming })
    if (hasLegacyOverrides && incoming.profiles === undefined) {
      merged.profiles = merged.profiles.map((profile) =>
        profile.id === merged.activeProfileId
          ? {
              ...profile,
              baseUrl: incoming.baseUrl ?? profile.baseUrl,
              apiKey: incoming.apiKey ?? profile.apiKey,
              model: incoming.model ?? profile.model,
              timeout: incoming.timeout ?? profile.timeout,
              apiMode: incoming.apiMode === 'images' || incoming.apiMode === 'responses' ? incoming.apiMode : profile.apiMode,
              codexCli: incoming.codexCli ?? profile.codexCli,
              apiProxy: incoming.apiProxy ?? profile.apiProxy,
              streamImages: incoming.streamImages ?? profile.streamImages,
              streamPartialImages: incoming.streamPartialImages ?? profile.streamPartialImages,
            }
          : profile,
      )
    }
    const effectiveDismissedPresetProviderIds = st.dismissedPresetProviderIds.filter((id) =>
      !isPresetProviderDeletionPrevented(id, previous.profiles),
    )
    const settings = normalizeSettings(enforcePresetConfigPolicy(merged, {
      dismissedPresetProviderIds: effectiveDismissedPresetProviderIds,
    }))
    // poolSettings 会显式给出「进入账号池后应生效」的选中值（生图/对话配置）。normalizeSettings 以
    // profiles 顺序兜底，会把它们覆盖掉，导致界面显示与请求实际使用的配置不一致，这里按显式值回写。
    const explicitSelections: Partial<Pick<AppSettings, 'activeProfileId' | 'agentTextProfileId' | 'agentImageProfileId'>> = {}
    if (incoming.activeProfileId && settings.profiles.some((p) => p.id === incoming.activeProfileId)) {
      settings.activeProfileId = incoming.activeProfileId
      explicitSelections.activeProfileId = incoming.activeProfileId
    }
    for (const key of ['agentTextProfileId', 'agentImageProfileId'] as const) {
      const id = incoming[key]
      if (typeof id === 'string' && id && settings.profiles.some((p) => p.id === id)) {
        settings[key] = id
        explicitSelections[key] = id
      }
    }
    const shouldClearReusedProfile = st.reusedTaskApiProfileId && settings.activeProfileId === st.reusedTaskApiProfileId
    return {
      settings,
      ...(shouldClearReusedProfile
        ? { reusedTaskApiProfileId: null, reusedTaskApiProfileName: null, reusedTaskApiProfileMissing: false }
        : {}),
    }
  }),
  setPresetImportedSettings: async (importedSettings, transform) => {
    set((state) => {
      const presetIds = getPresetProfileIds()
      const presetProviderIds = getPresetProviderIds()
      const dismissedPresetProfileIds = state.dismissedPresetProfileIds.filter((id) => presetIds.has(id))
      const deletionPrevented = isPresetConfigDeletionPrevented()
      const remainingPresetProfiles = (getPresetConfig()?.profiles ?? state.settings.profiles)
        .filter((profile) => !dismissedPresetProfileIds.includes(profile.id))
      const dismissedPresetProviderIds = state.dismissedPresetProviderIds
        .filter((id) => presetProviderIds.has(id))
      const effectiveDismissedPresetProviderIds = dismissedPresetProviderIds
        .filter((id) => !isPresetProviderDeletionPrevented(id, remainingPresetProfiles))
      const merged = mergePresetImportedSettings(state.settings, importedSettings, {
        lockPresetParams: isPresetConfigParamsLocked(),
        dismissedPresetProfileIds: deletionPrevented ? [] : dismissedPresetProfileIds,
        dismissedPresetProviderIds: effectiveDismissedPresetProviderIds,
        previousPresetConfig: state.previousPresetConfig,
        usedPresetProfileIds: state.tasks.flatMap((task) => task.apiProfileId ? [task.apiProfileId] : []),
      })
      const settings = normalizeSettings(enforcePresetConfigPolicy(
        normalizeSettings(transform?.(merged.settings) ?? merged.settings),
        { dismissedPresetProviderIds: effectiveDismissedPresetProviderIds },
      ))
      const shouldClearReusedProfile = state.reusedTaskApiProfileId && settings.activeProfileId === state.reusedTaskApiProfileId
      return {
        settings,
        previousPresetConfig: getPresetConfig() ? merged.presetConfig : null,
        dismissedPresetProfileIds,
        dismissedPresetProviderIds,
        reusedTaskApiProfileId: shouldClearReusedProfile ? null : state.reusedTaskApiProfileId,
        ...(shouldClearReusedProfile
          ? { reusedTaskApiProfileName: null, reusedTaskApiProfileMissing: false }
          : {}),
      }
    })
  },
  dismissedCodexCliPrompts: [],
  dismissCodexCliPrompt: (key) => set((st) => ({
    dismissedCodexCliPrompts: st.dismissedCodexCliPrompts.includes(key)
      ? st.dismissedCodexCliPrompts
      : [...st.dismissedCodexCliPrompts, key],
  })),
})
