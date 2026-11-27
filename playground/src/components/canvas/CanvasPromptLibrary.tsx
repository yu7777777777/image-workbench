import { useMemo, useState } from 'react'
import { loadCanvasPromptLibrary, saveCanvasPromptLibrary, type CanvasPromptEntry } from '../../lib/canvasPromptLibrary'
import { CanvasIcon } from './CanvasIcon'
import CreativeLibraryLink from '../CreativeLibraryLink'
import { useCreativePresets } from '../../hooks/useCreativePresets'

export function CanvasPromptLibrary({ onUse, onClose, showCreativeLink }: { onUse: (prompt: string, title?: string) => void; onClose: () => void; showCreativeLink?: boolean }) {
  const [entries, setEntries] = useState<CanvasPromptEntry[]>(() => loadCanvasPromptLibrary())
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<CanvasPromptEntry | null>(null)
  const [showFavorites, setShowFavorites] = useState(false)
  const favorites = useCreativePresets(showFavorites && showCreativeLink ? 'prompt' : null)
  const query = search.trim().toLowerCase()
  const favoriteMatches = favorites.items.filter(({ title, content }) => `${title} ${content}`.toLowerCase().includes(query))
  const visible = useMemo(() => { const query = search.trim().toLowerCase(); return entries.filter((item) => !query || `${item.title} ${item.prompt} ${item.tags.join(' ')}`.toLowerCase().includes(query)) }, [entries, search])
  const save = () => {
    if (!editing?.prompt.trim()) return
    const next = { ...editing, title: editing.title.trim() || '未命名提示词', prompt: editing.prompt.trim(), tags: editing.tags.map((tag) => tag.trim()).filter(Boolean), updatedAt: Date.now() }
    const updated = [next, ...entries.filter((item) => item.id !== next.id)]
    setEntries(updated); saveCanvasPromptLibrary(updated); setEditing(null)
  }
  const remove = (id: string) => { const updated = entries.filter((item) => item.id !== id); setEntries(updated); saveCanvasPromptLibrary(updated) }
  return <aside className="canvas-prompt-library" data-canvas-ui>
    <header><div><strong>提示词库</strong><p>保存和复用常用提示词</p></div><button aria-label="关闭提示词库" onClick={onClose}><CanvasIcon name="close" /></button></header>
    <input aria-label="搜索提示词" placeholder="搜索标题、内容或标签…" value={search} onChange={(event) => setSearch(event.target.value)} />
    <div className="canvas-prompt-library-actions flex items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1">
        {showCreativeLink && <>
          <button type="button" aria-pressed={!showFavorites} onClick={() => setShowFavorites(false)}>本地词库</button>
          <button type="button" aria-pressed={showFavorites} onClick={() => { setEditing(null); setShowFavorites(true) }}>广场收藏</button>
        </>}
        {!showFavorites && <button onClick={() => setEditing({ id: `prompt-${Date.now()}`, title: '', prompt: '', tags: [], updatedAt: Date.now() })}>新建提示词</button>}
      </div>
      {showCreativeLink && <CreativeLibraryLink className="text-xs underline underline-offset-4" onNavigate={onClose} />}
    </div>
    <div className="canvas-prompt-library-list">
      {showFavorites ? <>
        {favorites.status === 'loading' && <p className="canvas-library-empty" role="status">正在读取收藏…</p>}
        {favorites.status === 'error' && <div className="canvas-prompt-library-actions flex items-center gap-2"><p role="alert">收藏读取失败</p><button type="button" onClick={favorites.retry}>重试</button></div>}
        {favorites.status === 'ready' && favoriteMatches.map((item) => <article key={item.id}><div><strong>{item.display_title}</strong><p>{item.content}</p></div><div className="canvas-prompt-library-item-actions"><button type="button" onClick={() => onUse(item.content, item.display_title)}>使用</button></div></article>)}
        {favorites.status === 'ready' && !favoriteMatches.length && <p className="canvas-library-empty">{favorites.items.length ? '没有符合搜索条件的提示词。' : '在创意广场收藏提示词后，就能在这里使用。'}</p>}
      </> : <>
        {visible.map((item) => <article key={item.id}><div><strong>{item.title}</strong><p>{item.prompt}</p><small>{item.tags.map((tag) => `#${tag}`).join(' ')}</small></div><div className="canvas-prompt-library-item-actions"><button onClick={() => onUse(item.prompt)}>使用</button><button onClick={() => setEditing(item)}>编辑</button><button onClick={() => remove(item.id)}>删除</button></div></article>)}
        {!visible.length && <p className="canvas-library-empty">暂无提示词。</p>}
      </>}
    </div>
    {editing && <div className="canvas-prompt-editor" role="dialog" aria-label="编辑提示词"><strong>编辑提示词</strong><label>标题<input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label><label>提示词<textarea value={editing.prompt} onChange={(event) => setEditing({ ...editing, prompt: event.target.value })} /></label><label>标签<input value={editing.tags.join(', ')} onChange={(event) => setEditing({ ...editing, tags: event.target.value.split(/[,，]/) })} /></label><div><button onClick={() => setEditing(null)}>取消</button><button className="primary" onClick={save}>保存</button></div></div>}
  </aside>
}

