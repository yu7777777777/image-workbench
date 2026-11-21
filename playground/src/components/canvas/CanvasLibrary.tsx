import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { ensureImageThumbnailCached, subscribeImageThumbnail } from '../../lib/imageCache'
import { createCanvasAssetKey, loadCanvasAssetMetadata, updateCanvasAssetMetadata, type CanvasAssetMetadata, type CanvasAssetMetadataMap } from '../../lib/canvasAssetMetadata'
import { CanvasIcon } from './CanvasIcon'

function LibraryImage({ imageId, prompt, metadata, onAdd, onEdit }: { imageId: string; prompt: string; metadata: CanvasAssetMetadata; onAdd: () => void; onEdit: () => void }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let cancelled = false
    const apply = (thumbnail: { dataUrl: string }) => { if (!cancelled) setUrl(thumbnail.dataUrl) }
    const unsubscribe = subscribeImageThumbnail(imageId, apply)
    void ensureImageThumbnailCached(imageId).then((thumbnail) => { if (thumbnail) apply(thumbnail) }).catch(() => {})
    return () => { cancelled = true; unsubscribe() }
  }, [imageId])
  return <div className="canvas-library-card"><button className="canvas-library-image" title={prompt || '加入画布'} onClick={onAdd}>{url ? <img src={url} alt={prompt || '历史图片'} /> : <CanvasIcon name="image" />}<span>＋ 加入画布</span></button><div className="canvas-library-card-meta"><button className="canvas-library-edit" onClick={onEdit}>编辑</button>{metadata.category && <span>{metadata.category}</span>}{metadata.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}</div></div>
}

export function CanvasLibrary({ onAdd, onClose }: { onAdd: (taskId: string, imageId: string, outputIndex: number) => void; onClose: () => void }) {
  const tasks = useStore((state) => state.tasks)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('全部')
  const [metadata, setMetadata] = useState<CanvasAssetMetadataMap>(() => loadCanvasAssetMetadata())
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editingCategory, setEditingCategory] = useState('')
  const [editingTags, setEditingTags] = useState('')
  const [limit, setLimit] = useState(40)
  const entries = useMemo(() => tasks.filter((task) => task.outputImages.length).flatMap((task) => task.outputImages.map((imageId, outputIndex) => {
    const key = createCanvasAssetKey(task.id, imageId, outputIndex)
    return { task, imageId, outputIndex, key, metadata: metadata[key] ?? { category: '', tags: [] } }
  })).filter(({ task, metadata: itemMetadata }) => {
    const query = search.trim().toLowerCase()
    const searchable = `${task.prompt} ${itemMetadata.category} ${itemMetadata.tags.join(' ')}`.toLowerCase()
    return (!query || searchable.includes(query)) && (category === '全部' || itemMetadata.category === category)
  }), [category, metadata, search, tasks])
  const categories = useMemo(() => ['全部', ...Array.from(new Set(Object.values(metadata).map((item) => item.category).filter(Boolean))).sort()], [metadata])
  const editEntry = (key: string) => {
    const item = metadata[key] ?? { category: '', tags: [] }
    setEditingKey(key)
    setEditingCategory(item.category)
    setEditingTags(item.tags.join(', '))
  }
  const saveEntry = () => {
    if (!editingKey) return
    const next = updateCanvasAssetMetadata(editingKey, { category: editingCategory, tags: editingTags.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean) }, metadata)
    setMetadata(next)
    setEditingKey(null)
  }
  return <aside className="canvas-library" data-canvas-ui><header><div><strong>素材库</strong><p>选择图片，加入当前画布</p></div><button aria-label="关闭素材库" onClick={onClose}><CanvasIcon name="close" /></button></header><input aria-label="搜索素材" placeholder="搜索提示词或标签…" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(40) }} /><div className="canvas-library-filters" role="group" aria-label="素材分类筛选">{categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => { setCategory(item); setLimit(40) }}>{item}</button>)}</div><div className="canvas-library-scroll"><div className="canvas-library-grid">{entries.slice(0, limit).map(({ task, imageId, outputIndex, key, metadata: itemMetadata }) => <LibraryImage key={key} imageId={imageId} prompt={task.prompt} metadata={itemMetadata} onAdd={() => onAdd(task.id, imageId, outputIndex)} onEdit={() => editEntry(key)} />)}</div>{!entries.length && <p className="canvas-library-empty">暂无匹配素材，可调整搜索或分类。</p>}{entries.length > limit && <button className="canvas-load-more" onClick={() => setLimit(limit + 40)}>加载更多</button>}</div>{editingKey && <div className="canvas-library-editor" role="dialog" aria-label="编辑素材分类和标签"><strong>编辑素材信息</strong><label>分类<input value={editingCategory} placeholder="例如：产品、灵感、待整理" onChange={(event) => setEditingCategory(event.target.value)} /></label><label>标签<input value={editingTags} placeholder="用逗号分隔，如：红色, 电商" onChange={(event) => setEditingTags(event.target.value)} /></label><div><button onClick={() => setEditingKey(null)}>取消</button><button className="primary" onClick={saveEntry}>保存</button></div></div>}</aside>
}
