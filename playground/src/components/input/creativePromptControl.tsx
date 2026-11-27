import { useEffect, useId, useRef, useState } from 'react'
import { appendCreativeText, fetchCreativeCover, type CreativeItem } from '../../lib/creativeLibrary'
import { useCreativePresets } from '../../hooks/useCreativePresets'
import { useStore } from '../../store'
import { FavoriteIcon } from '../icons'
import CreativeLibraryLink from '../CreativeLibraryLink'

export default function CreativePromptControl() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="studio-agent-control" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <FavoriteIcon aria-hidden="true" className="size-4 shrink-0" />提示词预览
      </button>
      {open && <PromptPicker onClose={() => setOpen(false)} />}
    </>
  )
}

function PromptPicker({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const { status, items, retry } = useCreativePresets('prompt')
  const applyPrompt = (item: CreativeItem) => {
    const state = useStore.getState()
    state.setPrompt(appendCreativeText(state.prompt, item.content))
    state.showToast('提示词已加入输入框', 'success')
    dialog.current?.close()
  }

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [])

  return <dialog ref={dialog} className="studio-agent-skill-editor studio-prompt-preview-dialog" aria-labelledby={titleId} onClose={onClose}>
    <div className="flex flex-col gap-4">
      <div>
        <h2 id={titleId} className="text-base font-semibold">提示词预览</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">点选收藏的图片或文字卡，即可加入当前提示词。</p>
      </div>
      {status === 'loading' && <p role="status" className="text-sm">正在读取…</p>}
      {status === 'error' && <div className="flex items-center gap-3 text-sm">
        <p role="alert">读取失败</p>
        <button type="button" className="studio-agent-control" onClick={retry}>重试</button>
      </div>}
      {status === 'ready' && (items.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {items.map((item) => <PromptPreviewTile key={item.id} item={item} onSelect={() => applyPrompt(item)} />)}
        </div>
      ) : <p className="text-sm">在创意广场收藏提示词后，就能在这里选择。</p>)}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <CreativeLibraryLink className="mr-auto text-sm underline underline-offset-4" onNavigate={() => dialog.current?.close()} />
        <button type="button" className="studio-agent-control" onClick={() => dialog.current?.close()}>取消</button>
      </div>
    </div>
  </dialog>
}

function PromptPreviewTile({ item, onSelect }: { item: CreativeItem; onSelect: () => void }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    if (!item.has_cover) return
    const controller = new AbortController()
    let url = ''
    void fetchCreativeCover(item.id, controller.signal).then((blob) => {
      if (controller.signal.aborted) return
      url = URL.createObjectURL(blob)
      setSrc(url)
    }).catch(() => {})
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [item.has_cover, item.id])
  return (
    <button type="button" aria-label={`使用提示词 ${item.display_title}`} onClick={onSelect}
      className="studio-prompt-preview-tile aspect-[3/2] overflow-hidden rounded-xl border text-left transition-colors">
      {src ? <img src={src} alt="" className="size-full object-cover" /> :
        <span className="line-clamp-3 break-words px-3 text-sm">{item.display_title}</span>}
    </button>
  )
}
