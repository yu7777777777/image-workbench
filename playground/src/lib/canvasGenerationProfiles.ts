import type { ApiProfile, AppSettings } from '../types'
import { isPoolBuild } from './accountPool'
import { isAgentTextApiProfile, validateApiProfile } from './apiProfiles'
import { POOL_PROFILE_ID } from './poolProfileIds'
import { isPresetConfigOnlyEnabled, isPresetProfile } from './presetConfig'

export function getCanvasGenerationProfiles(settings: AppSettings): ApiProfile[] {
  const presetOnly = isPresetConfigOnlyEnabled()
  return settings.profiles.filter((profile) => {
    if (isAgentTextApiProfile(profile)) return false
    const isSiteProfile = isPoolBuild && (profile.id === POOL_PROFILE_ID || profile.id.startsWith('shared-'))
    return (!presetOnly || isSiteProfile || isPresetProfile(profile.id))
      && (!isPoolBuild || !validateApiProfile(profile))
  })
}

export function resolveCanvasGenerationProfile(
  settings: AppSettings,
  profiles: ApiProfile[],
  profileId?: string,
): ApiProfile | undefined {
  return profiles.find((profile) => profile.id === profileId)
    ?? (isPoolBuild ? profiles.find((profile) => profile.id === POOL_PROFILE_ID) : undefined)
    ?? profiles.find((profile) => profile.id === settings.activeProfileId)
    ?? profiles[0]
}
