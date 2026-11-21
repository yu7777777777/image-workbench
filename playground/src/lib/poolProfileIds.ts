/**
 * 站内账号池 profile 的固定 ID。
 *
 * 这些 ID 被 apiProfiles.ts（判定文本模型 / 归一化 agentTextProfileId）与
 * accountPool.ts（构造账号池 profile）共用。放在这个不含任何 import 的叶子模块里，
 * 是为了避免 apiProfiles.ts 反向 import accountPool.ts 造成循环依赖。
 */
export const POOL_PROFILE_ID = 'chatgpt2api-pool'
export const POOL_AGENT_PROFILE_ID = 'chatgpt2api-pool-agent'
export const LEGACY_LOCAL_POOL_PROFILE_ID = 'local-image-api'

/** 站内账号池的 profile ID（生图池、Agent 池，以及历史遗留的本地池 ID）。 */
export const POOL_PROFILE_IDS: readonly string[] = [
  POOL_PROFILE_ID,
  POOL_AGENT_PROFILE_ID,
  LEGACY_LOCAL_POOL_PROFILE_ID,
]

/** 是否为站内账号池 profile。账号池不是第三方文本模型，不能出现在「对话模型」下拉框里。 */
export const poolProfileIdSet: ReadonlySet<string> = new Set(POOL_PROFILE_IDS)

export function isPoolProfileId(id: string): boolean {
  return poolProfileIdSet.has(id)
}
