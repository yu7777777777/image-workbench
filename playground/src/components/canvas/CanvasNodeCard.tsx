import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CanvasAssetRole, CanvasNode, TaskParams } from '../../types'
import { useStore } from '../../store'
import { ensureImageCached } from '../../lib/imageCache'
import { CanvasIcon } from './CanvasIcon'
import { isAgentTextApiProfile } from '../../lib/apiProfiles'
import { isPresetConfigOnlyEnabled, isPresetProfile } from '../../lib/presetConfig'
import { CANVAS_ASSET_ROLE_LABELS, getCanvasImageId, getCanvasPromptImageRefs, resolveCanvasSourceIds } from '../../lib/canvasWorkflow'

interface CanvasNodeCardProps {
  node: CanvasNode
  isSelected: boolean
  onPointerDown: (event: React.PointerEvent, nodeId: string) => void
  onResizeStart: (event: React.PointerEvent, nodeId: string) => void
  onConnect: (event: React.PointerEvent, nodeId: string) => void
  onDoubleClick: (nodeId: string) => void
  onMenu: (event: React.MouseEvent, nodeId: string) => void
  onRun: (nodeId: string) => void
  onEdit: (nodeId: string) => void
  onDownload: (nodeId: string) => void
  hasConnectedText: boolean
  busy: boolean
  isConnectionTarget?: boolean
  onPromptLibrary?: (nodeId: string) => void
  onPromptRewrite?: (nodeId: string, profileId: string) => void
  promptRewriteBusy?: boolean
}

export const CanvasNodeCard = memo(function CanvasNodeCard(props: CanvasNodeCardProps) {
  const { node } = props
  const task = useStore((state) => state.tasks.find((task) => task.id === node.taskId))
  const settings = useStore((state) => state.settings)
  const patch = useStore((state) => state.updateCanvasNode)
  const imageId = node.imageId || task?.outputImages[node.outputIndex ?? 0]
  const [imageUrl, setImageUrl] = useState(node.imageUrl || '')

  useEffect(() => {
    let cancelled = false
    setImageUrl(node.imageUrl || '')
    if (imageId) void ensureImageCached(imageId).then((url) => {
      if (!cancelled) setImageUrl(url || '')
    }).catch(() => { if (!cancelled) setImageUrl('') })
    return () => { cancelled = true }
  }, [imageId, node.imageUrl])

  const generation = node.type === 'generation'
  const text = node.type === 'text'
  const running = props.busy || task?.status === 'running'
  const title = node.label || (generation ? 'API 生成' : text ? '提示词' : '图片')
  const updateParams = (params: Partial<TaskParams>) => patch(node.id, { params: { ...node.params, ...params } })
  const profiles = (isPresetConfigOnlyEnabled() ? settings.profiles.filter((profile) => isPresetProfile(profile.id)) : settings.profiles)
    .filter((profile) => !isAgentTextApiProfile(profile))
  const textProfiles = settings.profiles.filter((profile) => isAgentTextApiProfile(profile))
  const [rewriteProfileId, setRewriteProfileId] = useState(settings.agentTextProfileId || textProfiles[0]?.id || '')
  const fallbackProfileId = profiles.find((profile) => profile.id === settings.activeProfileId)?.id ?? profiles[0]?.id ?? ''
  const profileId = profiles.some((profile) => profile.id === node.profileId) ? node.profileId : fallbackProfileId
  const promptMode = props.hasConnectedText ? node.promptMode ?? 'connected' : 'own'
  const insertPrompt = (text: string) => patch(node.id, { prompt: `${node.prompt?.trim() ? `${node.prompt.trim()}\n` : ''}${text}` })
  const hasPrompt = Boolean(node.prompt?.trim() || node.label?.trim())

  // 生成节点的参考图按提交顺序编号，提示词里输入 @ 即可引用“图N”。
  const canvasNodes = useStore((state) => state.canvasNodes)
  const tasks = useStore((state) => state.tasks)
  const imageRefs = generation ? getCanvasPromptImageRefs(node, canvasNodes, tasks) : []
  // 图片节点显示它在已连接生成节点里的编号，和 @图N 对得上。
  const connectRef = generation ? undefined : (() => {
    const assetId = getCanvasImageId(node, tasks) || node.id
    const target = canvasNodes.find((item) => item.type === 'generation' && (item.sourceNodeIds ?? []).some((sourceId) => resolveCanvasSourceIds(canvasNodes, sourceId).includes(node.id)))
    if (!target) return undefined
    return getCanvasPromptImageRefs(target, canvasNodes, tasks).find((ref) => ref.assetId === assetId)
  })()
  const [mention, setMention] = useState<{ start: number; end: number; query: string; active: number } | null>(null)
  const [caret, setCaret] = useState(0)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const mentionListRef = useRef<HTMLDivElement>(null)
  const mentionOptions = mention
    ? imageRefs.filter((ref) => `${ref.index + 1}`.includes(mention.query) || CANVAS_ASSET_ROLE_LABELS[ref.role].includes(mention.query))
    : []
  const mentionOpen = Boolean(mention && mentionOptions.length)
  // 中文输入法下 @ 只是普通字符，这里统一用 @图N 作为可读引用，提交时再展开成角色说明。
  const mentionLabel = (index: number) => `@图${index + 1}`
  const syncMention = (value: string, position: number) => {
    const before = value.slice(0, position)
    const hit = /@([^\s@]{0,8})$/.exec(before)
    if (!hit) { setMention(null); return }
    setMention({ start: before.length - hit[0].length, end: position, query: hit[1], active: 0 })
  }
  const acceptMention = (index: number) => {
    if (!mention) return
    const next = `${node.prompt?.slice(0, mention.start) ?? ''}${mentionLabel(index)} ${node.prompt?.slice(mention.end) ?? ''}`
    patch(node.id, { prompt: next })
    const position = mention.start + mentionLabel(index).length + 1
    setMention(null)
    window.requestAnimationFrame(() => {
      const el = promptRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(position, position)
    })
  }
  const insertAtCaret = (snippet: string) => {
    const value = node.prompt ?? ''
    const el = promptRef.current
    const start = el ? el.selectionStart : caret
    const end = el ? el.selectionEnd : caret
    patch(node.id, { prompt: `${value.slice(0, start)}${snippet}${value.slice(end)}` })
    const position = start + snippet.length
    setCaret(position)
    window.requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(position, position)
    })
  }
  useLayoutEffect(() => {
    const list = mentionListRef.current
    if (!list) return
    const item = list.querySelector<HTMLElement>(`[data-mention-index="${mention?.active ?? 0}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [mention?.active, mention?.query, mentionOpen])
  const onPromptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!mentionOpen) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setMention((current) => current && { ...current, active: (current.active + step + mentionOptions.length) % mentionOptions.length })
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const option = mentionOptions[mention?.active ?? 0]
      if (!option) return
      event.preventDefault()
      acceptMention(option.index)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setMention(null)
    }
  }

  return (
    <article className={`canvas-node ${props.isSelected ? 'is-selected' : ''} ${generation ? 'is-generation' : ''} ${props.isConnectionTarget ? 'is-connection-target' : ''}`}
      style={{ left: node.position.x, top: node.position.y, width: node.width, height: node.height, zIndex: props.isSelected ? node.zIndex + 1000 : node.zIndex }}
      data-canvas-node={node.id} onPointerDown={(event) => props.onPointerDown(event, node.id)} onContextMenu={(event) => { if (!(event.target as Element).closest('input,textarea,select,[contenteditable]')) props.onMenu(event, node.id) }}
      onDoubleClick={(event) => { if (!(event.target as Element).closest('button,input,textarea,select')) props.onDoubleClick(node.id) }}>
      <header className="canvas-node-header"><span className="canvas-node-title"><CanvasIcon name={generation ? 'generate' : text ? 'text' : 'image'} /><span>{title}</span></span><span className="canvas-node-badge">{node.locked ? '锁定' : generation ? 'IMAGE' : text ? 'TEXT' : '素材'}</span><button className="canvas-node-more" title="节点菜单" aria-label={`${title}节点菜单`} onClick={(event) => props.onMenu(event, node.id)}>···</button></header>
      {text ? <div className="canvas-text-body"><textarea aria-label="提示词节点内容" className="canvas-prompt canvas-text-node" placeholder="写下画面描述，连接到生成节点…" value={node.prompt ?? node.label ?? ''} onChange={(event) => patch(node.id, { prompt: event.target.value })} /><div className="canvas-prompt-presets"><button type="button" onClick={() => props.onPromptLibrary?.(node.id)}>模板库</button>{textProfiles.length > 0 && <select aria-label="润色模型" value={rewriteProfileId} onChange={(event) => setRewriteProfileId(event.target.value)}>{textProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}</select>}<button type="button" disabled={!hasPrompt || !textProfiles.length || props.promptRewriteBusy} onClick={() => props.onPromptRewrite?.(node.id, rewriteProfileId)}>{props.promptRewriteBusy ? 'AI润色中…' : 'AI润色'}</button></div></div> : generation ? (
        <div className={`canvas-generation-body ${props.hasConnectedText ? 'has-prompt-source' : ''}`}>
          <label>生图配置<select aria-label="生图配置" value={profileId} onChange={(event) => patch(node.id, { profileId: event.target.value })}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.imageGenerationModel || profile.model}</option>)}</select></label>
          {props.hasConnectedText && <div className="canvas-prompt-source" aria-label="提示词来源"><span>提示词</span>{([['connected', '连线'], ['own', '本节点'], ['combine', '合并']] as const).map(([mode, label]) => <button key={mode} type="button" className={promptMode === mode ? 'active' : ''} aria-pressed={promptMode === mode} title={mode === 'connected' ? '只使用连入的提示词节点' : mode === 'own' ? '只使用当前生成节点的提示词' : '合并连入节点与当前节点的提示词'} onClick={() => patch(node.id, { promptMode: mode })}>{label}</button>)}</div>}
          <div className="canvas-prompt-wrap">
            <textarea aria-label="生成提示词" className={`canvas-prompt ${props.hasConnectedText && promptMode === 'connected' ? 'is-inactive' : ''}`} disabled={props.hasConnectedText && promptMode === 'connected'} placeholder={props.hasConnectedText ? '切换到“本节点”或“合并”后填写…' : '描述画面或修改要求…\n输入 @ 引用参考图，如 @图1 的姿态、@图2 的服装。'} ref={promptRef} value={node.prompt || ''} onChange={(event) => { patch(node.id, { prompt: event.target.value }); setCaret(event.target.selectionStart); syncMention(event.target.value, event.target.selectionStart) }} onKeyDown={onPromptKeyDown} onBlur={() => setMention(null)} />
            {mentionOpen && <div className="canvas-mention-popup" role="listbox" aria-label="引用参考图" ref={mentionListRef}>{mentionOptions.map((ref, position) => <button key={ref.assetId} type="button" role="option" aria-selected={position === (mention?.active ?? 0)} data-mention-index={position} className={position === (mention?.active ?? 0) ? 'active' : ''} onMouseDown={(event) => { event.preventDefault(); acceptMention(ref.index) }}><b>{mentionLabel(ref.index)}</b><span>{CANVAS_ASSET_ROLE_LABELS[ref.role]}</span></button>)}</div>}
          </div>
          <div className="canvas-prompt-presets" aria-label="提示词快捷片段"><span>快速加入</span><button type="button" onClick={() => insertPrompt('主体：')} >主体</button><button type="button" onClick={() => insertPrompt('构图与姿态：')} >构图</button><button type="button" onClick={() => insertPrompt('场景与光线：')} >场景</button><button type="button" onClick={() => insertPrompt('限制：保持产品细节，不添加文字。')} >约束</button>{imageRefs.length > 0 && <button type="button" className="canvas-mention-trigger" title="插入参考图引用" onClick={() => insertAtCaret('@')}>@ 引用</button>}</div>
          <div className="canvas-params"><label>尺寸<select aria-label="节点尺寸" value={node.params?.size || '1254x1254'} onChange={(event) => updateParams({ size: event.target.value })}>{['auto', '1254x1254', '1024x1536', '1536x1024', '940x1672', '1672x940'].map((size) => <option key={size} value={size}>{size === 'auto' ? '自动' : size.replace('x', ' × ')}</option>)}</select></label><label>质量<select aria-label="节点质量" value={node.params?.quality || 'auto'} onChange={(event) => updateParams({ quality: event.target.value as TaskParams['quality'] })}>{['auto', 'low', 'medium', 'high'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>数量<input aria-label="节点数量" type="number" min="1" max="10" value={node.params?.n ?? 1} onChange={(event) => updateParams({ n: Math.max(1, Math.min(10, Number(event.target.value) || 1)) })} /></label></div>
          <div className="canvas-input-count"><CanvasIcon name="link" />{props.hasConnectedText ? promptMode === 'own' ? '文字连线未参与生成' : promptMode === 'combine' ? '连线与本节点提示词一起提交' : '只使用连线提示词' : node.sourceNodeIds?.length ? `${node.sourceNodeIds.length} 个输入 · 图片` : '拖动素材右侧圆点，连接到左侧圆点'}</div>
          <button className="canvas-run" disabled={running} onClick={() => props.onRun(node.id)}><CanvasIcon name="play" />{running ? '正在生成…' : '执行生成'}</button>
          {task?.error && <p className="canvas-node-error" title={task.error}>{task.error}</p>}{task?.status === 'done' && <p className="canvas-node-success">已完成 · {task.outputImages.length} 张图片</p>}
          <div className="canvas-prompt-presets"><button type="button" onClick={() => props.onPromptLibrary?.(node.id)}>模板库</button>{textProfiles.length > 0 && <select aria-label="润色模型" value={rewriteProfileId} onChange={(event) => setRewriteProfileId(event.target.value)}>{textProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.model}</option>)}</select>}<button type="button" disabled={!hasPrompt || !textProfiles.length || props.promptRewriteBusy} onClick={() => props.onPromptRewrite?.(node.id, rewriteProfileId)}>{props.promptRewriteBusy ? 'AI润色中…' : 'AI润色'}</button></div>
        </div>
      ) : <><div className="canvas-image-area" title="双击放大预览">{connectRef && <span className="canvas-image-index" title={`提示词里用 ${mentionLabel(connectRef.index)} 引用这张图`}>{mentionLabel(connectRef.index)}</span>}{imageUrl ? <><img src={imageUrl} alt={title} draggable={false} data-image-id={imageId} /><span className="canvas-image-zoom-hint">双击放大</span></> : <span>{task?.status === 'running' ? '正在生成…' : task?.error ? '生成失败' : '图片暂不可用'}</span>}</div><footer className="canvas-image-footer"><label title="是否参与生成"><input type="checkbox" checked={node.assetEnabled !== false} onChange={(event) => patch(node.id, { assetEnabled: event.target.checked })} />参考</label><select aria-label="素材角色" value={node.assetRole || 'other'} onChange={(event) => patch(node.id, { assetRole: event.target.value as CanvasAssetRole })}>{Object.entries(CANVAS_ASSET_ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span title={task?.prompt || node.label}>{task?.prompt || node.label || '连接到生成节点作为参考图'}</span><button title="以此图编辑" aria-label="以此图编辑" onClick={() => props.onEdit(node.id)}><CanvasIcon name="generate" /></button><button title="下载图片" aria-label="下载图片" disabled={!imageUrl} onClick={() => props.onDownload(node.id)}><CanvasIcon name="download" /></button></footer></>}
      {generation && <button className="canvas-port canvas-port-input" data-canvas-input={node.id} title="输入：图片 / 提示词" aria-label="连接输入" />}
      <button className="canvas-port canvas-port-output" title="拖动连接到生成节点" aria-label="连接输出" onPointerDown={(event) => props.onConnect(event, node.id)} />
      {!node.locked && <button type="button" className="canvas-node-resize" data-canvas-ui aria-label="调整节点大小" title="拖动调整节点大小" onPointerDown={(event) => props.onResizeStart(event, node.id)} />}
    </article>
  )
})

