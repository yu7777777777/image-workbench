import {
  DEFAULT_AGENT_HISTORY_IMAGE_ROUNDS,
  DEFAULT_AGENT_MAX_TOOL_ROUNDS,
  type AgentApiConfigMode,
  type ApiProfile,
  type AppSettings,
} from '../../types'
import { normalizeAgentHistoryImageRounds, normalizeAgentMaxToolRounds } from '../../lib/apiProfiles'
import Select from '../Select'

interface SelectOption {
  label: string
  value: string
}

interface AgentSettingsTabProps {
  draft: AppSettings
  agentMaxToolRoundsInput: string
  agentHistoryImageRoundsInput: string
  agentTextProfileOptions: SelectOption[]
  agentImageProfileOptions: SelectOption[]
  selectedAgentTextProfile: ApiProfile | null
  selectedAgentImageProfile: ApiProfile | null
  setAgentMaxToolRoundsInput: (value: string) => void
  setAgentHistoryImageRoundsInput: (value: string) => void
  updateAgentApiConfigMode: (mode: AgentApiConfigMode) => void
  /** 打开「账号与密钥 → API 配置」页：本页只能选已有配置，新建必须去那里。 */
  openApiSettings: () => void
  commitSettings: (nextDraft: AppSettings) => void
  commitAgentMaxToolRounds: () => void
  commitAgentHistoryImageRounds: () => void
}

export default function AgentSettingsTab({
  draft,
  agentMaxToolRoundsInput,
  agentHistoryImageRoundsInput,
  agentTextProfileOptions,
  agentImageProfileOptions,
  selectedAgentTextProfile,
  selectedAgentImageProfile,
  setAgentMaxToolRoundsInput,
  setAgentHistoryImageRoundsInput,
  updateAgentApiConfigMode,
  openApiSettings,
  commitSettings,
  commitAgentMaxToolRounds,
  commitAgentHistoryImageRounds,
}: AgentSettingsTabProps) {
  const hasTextProfiles = agentTextProfileOptions.length > 0
  return (
    <div className="space-y-4">
      <div className="block">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="block text-sm text-gray-600 dark:text-gray-300">Agent API 模式</span>
          <div className="w-40 shrink-0">
            <Select
              value={draft.agentApiConfigMode}
              onChange={(value) => updateAgentApiConfigMode(value as AgentApiConfigMode)}
              options={[
                { label: '关闭（沿用主配置）', value: 'off' },
                { label: '原生（Responses API）', value: 'native' },
                { label: '混合（文本 + 生图分开配置）', value: 'hybrid' },
              ]}
              className="w-full px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] text-xs transition-all duration-200 shadow-sm text-gray-700 dark:text-gray-200 outline-none"
            />
          </div>
        </div>
        <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500 space-y-1">
          <div>原生：由对话模型直接调用 <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] dark:bg-white/[0.06]">image_generation</code> 工具生成图片。</div>
          <div>混合：对话模型调用自定义工具，再请求图像模型生成图片，解决部分服务商/模型不支持 <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] dark:bg-white/[0.06]">image_generation</code> 工具的问题。</div>
        </div>
      </div>

      {draft.agentApiConfigMode !== 'off' && (
        <>
          <div className="block">
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="block text-sm text-gray-600 dark:text-gray-300">对话模型 API 配置</span>
              <div className="w-40 shrink-0">
                {hasTextProfiles ? (
                  <Select
                    value={selectedAgentTextProfile?.id ?? '请选择配置'}
                    onChange={(value) => commitSettings({ ...draft, agentTextProfileId: String(value) })}
                    options={agentTextProfileOptions}
                    showValueTooltips
                    className="w-full px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] text-xs transition-all duration-200 shadow-sm text-gray-700 dark:text-gray-200 outline-none"
                  />
                ) : (
                  <div className="w-full rounded-xl border border-gray-200/60 bg-white/50 px-3 py-1.5 text-center text-xs text-gray-700 shadow-sm transition-all duration-200 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200">
                    没有可用配置
                  </div>
                )}
              </div>
            </div>
            <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
              默认使用「本站账号池 (Agent)」，直接调用本站账号，无需填写任何 API Key；第三方 Responses API 配置仅在需要时选用。
            </div>
            <button
              type="button"
              onClick={openApiSettings}
              className="mt-1.5 rounded-xl border border-gray-200/60 bg-white/50 px-3 py-1.5 text-xs text-gray-700 shadow-sm transition-all duration-200 hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/[0.06]"
            >
              {hasTextProfiles ? '管理 API 配置' : '去新建 / 启用对话模型'}
            </button>
          </div>

          {draft.agentApiConfigMode === 'hybrid' && (
            <div className="block">
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="block text-sm text-gray-600 dark:text-gray-300">图像模型 API 配置</span>
                <div className="w-40 shrink-0">
                  {agentImageProfileOptions.length > 0 ? (
                    <Select
                      value={selectedAgentImageProfile?.id ?? '请选择配置'}
                      onChange={(value) => commitSettings({ ...draft, agentImageProfileId: String(value) })}
                      options={agentImageProfileOptions}
                      showValueTooltips
                      className="w-full px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] text-xs transition-all duration-200 shadow-sm text-gray-700 dark:text-gray-200 outline-none"
                    />
                  ) : (
                    <div className="w-full rounded-xl border border-gray-200/60 bg-white/50 px-3 py-1.5 text-center text-xs text-gray-700 shadow-sm transition-all duration-200 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200">
                      没有可用配置
                    </div>
                  )}
                </div>
              </div>
              <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                用于生成图像，支持所有类型的 API 配置，本站账号池也可以放在这里。
              </div>            </div>
          )}
        </>
      )}
      <label className="block">
        <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">最大工具调用轮数</span>
        <input
          value={agentMaxToolRoundsInput}
          onChange={(e) => setAgentMaxToolRoundsInput(e.target.value)}
          onBlur={commitAgentMaxToolRounds}
          type="number"
          min={1}
          max={50}
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
        <div data-selectable-text className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-500">
          默认 15。用于限制 Agent 连续调用工具时的最大轮数，防止无限循环。
        </div>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">历史图片保留轮数</span>
        <input
          value={agentHistoryImageRoundsInput}
          onChange={(e) => setAgentHistoryImageRoundsInput(e.target.value)}
          onBlur={commitAgentHistoryImageRounds}
          type="number"
          min={0}
          max={20}
          className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
        />
        <div data-selectable-text className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-500">
          默认 2。限制连续对话时发送给大模型的早期图片实体数量。超出该轮数的历史图片只保留提示词与引用标签（不传完整图片实体），防止多轮生图后上下文超出 10 万 Token 上限报错。
        </div>
      </label>
      <div className="block">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="block text-sm text-gray-600 dark:text-gray-300">网络搜索</span>
          <button
            type="button"
            onClick={() => {
              const agentMaxToolRounds = agentMaxToolRoundsInput.trim() === ''
                ? DEFAULT_AGENT_MAX_TOOL_ROUNDS
                : normalizeAgentMaxToolRounds(agentMaxToolRoundsInput, draft.agentMaxToolRounds)
              const agentHistoryImageRounds = agentHistoryImageRoundsInput.trim() === ''
                ? DEFAULT_AGENT_HISTORY_IMAGE_ROUNDS
                : normalizeAgentHistoryImageRounds(agentHistoryImageRoundsInput, draft.agentHistoryImageRounds)
              setAgentMaxToolRoundsInput(String(agentMaxToolRounds))
              setAgentHistoryImageRoundsInput(String(agentHistoryImageRounds))
              commitSettings({ ...draft, agentMaxToolRounds, agentHistoryImageRounds, agentWebSearch: !draft.agentWebSearch })
            }}
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${draft.agentWebSearch ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
            role="switch"
            aria-checked={draft.agentWebSearch}
            aria-label="网络搜索"
          >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${draft.agentWebSearch ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
          </button>
        </div>
        <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
          启用 Responses API 的 <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] dark:bg-white/[0.06]">web_search</code> 工具。模型每次调用此工具会产生少量固定价格的额外计费。
        </div>
      </div>
    </div>
  )
}
