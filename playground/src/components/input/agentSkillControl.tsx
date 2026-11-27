import { useEffect, useId, useRef, useState } from 'react'
import type { AgentSkill } from '../../types'
import {
  AGENT_SKILL_FILE_LIMIT,
  AGENT_SKILL_NAME_LIMIT,
  AGENT_SKILL_TEXT_LIMIT,
  normalizeAgentSkill,
  readAgentSkillMarkdown,
} from '../../lib/agentSkill'
import { EditIcon, PlusIcon } from '../icons'
import { isPoolBuild } from '../../lib/accountPool'
import { getWorkbenchOwner } from '../../lib/workbenchOwner'
import CreativeLibraryLink from '../CreativeLibraryLink'
import { useCreativePresets } from '../../hooks/useCreativePresets'

export default function AgentSkillControl({
  skill,
  onChange,
}: {
  skill?: AgentSkill
  onChange: (skill: AgentSkill | undefined) => void
}) {
  const [skillEditorOpen, setSkillEditorOpen] = useState(false)

  return (
    <div className="studio-agent-skill-control">
      <button
        type="button"
        className="studio-agent-control studio-agent-skill"
        aria-haspopup="dialog"
        aria-label={skill ? `编辑生图技能，${skill.name}` : '添加生图技能'}
        title={skill?.name}
        onClick={() => setSkillEditorOpen(true)}
      >
        {skill ? <EditIcon aria-hidden="true" className="size-4 shrink-0" /> : <PlusIcon aria-hidden="true" className="size-4 shrink-0" />}
        <span className="truncate">{skill ? skill.name : '添加生图技能'}</span>
      </button>
      {skillEditorOpen && (
        <AgentSkillEditor
          skill={skill}
          onSave={onChange}
          onClose={() => setSkillEditorOpen(false)}
        />
      )}
    </div>
  )
}

function AgentSkillEditor({
  skill,
  onSave,
  onClose,
}: {
  skill?: AgentSkill
  onSave: (skill: AgentSkill | undefined) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const [name, setName] = useState(skill?.name ?? '')
  const [instructions, setInstructions] = useState(skill?.instructions ?? '')
  const [presetId, setPresetId] = useState('')
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const canUseCreative = isPoolBuild && getWorkbenchOwner().startsWith('admin:')
  const presets = useCreativePresets(canUseCreative ? 'skill' : null)
  const validSkill = normalizeAgentSkill({ name, instructions })

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  async function importSkill(file: File) {
    setError('')
    if (!/\.md$/i.test(file.name) || file.size > AGENT_SKILL_FILE_LIMIT) {
      setError('请选择小于或等于 64 KB 的 Markdown 文件。')
      return
    }
    setReading(true)
    try {
      const imported = readAgentSkillMarkdown(await file.text(), file.name)
      if (!normalizeAgentSkill(imported)) {
        setError(`技能需要包含正文，长度最多 ${AGENT_SKILL_TEXT_LIMIT.toLocaleString()} 个字符。`)
        return
      }
      setName(imported.name)
      setInstructions(imported.instructions)
      setPresetId('')
    } catch {
      setError('读取 Markdown 文件失败。')
    } finally {
      setReading(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="studio-agent-skill-editor"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!validSkill || reading) return
          onSave(validSkill)
          dialogRef.current?.close()
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={titleId} className="text-base font-semibold">{skill ? '编辑生图技能' : '添加生图技能'}</h2>
          <button type="button" className="studio-agent-control" disabled={reading} onClick={() => fileRef.current?.click()}>
            导入 Markdown
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".md,text/markdown"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void importSkill(file)
            }}
          />
        </div>
        {canUseCreative && (
          <div className="flex flex-col gap-1.5">
            <label className="flex flex-col gap-1.5 text-sm font-medium">收藏的生图技能
              <select className="studio-agent-skill-field" value={presetId} disabled={presets.status !== 'ready' || !presets.items.length || reading} onChange={(event) => {
                const item = presets.items.find(({ id }) => id === event.target.value)
                if (!item) return
                const { instructions } = readAgentSkillMarkdown(item.content, item.display_title)
                const saved = normalizeAgentSkill({ name: item.display_title, instructions })
                if (!saved) {
                  setError('此生图技能的内容不符合要求。')
                  return
                }
                setError('')
                setName(saved.name)
                setInstructions(saved.instructions)
                setPresetId(item.id)
              }}>
                <option value="" disabled>{presets.status === 'loading' ? '正在读取…' : presets.status === 'error' ? '收藏读取失败' : presets.items.length ? '选择收藏的技能' : '在创意广场收藏技能后可选'}</option>
                {presets.items.map(({ id, display_title }) => <option key={id} value={id}>{display_title}</option>)}
              </select>
            </label>
            {presets.status === 'error' && <button type="button" className="studio-agent-control self-start" onClick={presets.retry}>重试</button>}
          </div>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">名称</span>
          <input
            className="studio-agent-skill-field"
            value={name}
            maxLength={AGENT_SKILL_NAME_LIMIT}
            onChange={(event) => { setPresetId(''); setName(event.target.value) }}
            placeholder="例如小红书封面"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">技能步骤</span>
          <textarea
            className="studio-agent-skill-field"
            value={instructions}
            maxLength={AGENT_SKILL_TEXT_LIMIT}
            onChange={(event) => { setPresetId(''); setInstructions(event.target.value) }}
            placeholder="粘贴 Markdown，或直接写下 Agent 要遵循的步骤"
            rows={6}
          />
        </label>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canUseCreative && (
            <CreativeLibraryLink className="mr-auto text-sm underline underline-offset-4" onNavigate={() => dialogRef.current?.close()} />
          )}
          {skill && (
            <button
              type="button"
              className="studio-agent-control mr-auto"
              onClick={() => {
                onSave(undefined)
                dialogRef.current?.close()
              }}
            >
              移除技能
            </button>
          )}
          <button type="button" className="studio-agent-control" onClick={() => dialogRef.current?.close()}>取消</button>
          <button type="submit" className="studio-submit studio-submit-primary px-3 text-sm font-medium" disabled={!validSkill || reading}>
            {skill ? '保存修改' : '挂载到对话'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
