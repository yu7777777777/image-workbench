import { memo, useState } from 'react'

interface CanvasAgentPanelProps {
  isOpen: boolean
  onClose: () => void
}

export const CanvasAgentPanel = memo(function CanvasAgentPanel({ isOpen, onClose }: CanvasAgentPanelProps) {
  const [inputValue, setInputValue] = useState('')

  return (
    <div
      className={`fixed right-0 top-0 h-full w-[400px] z-50
        bg-zinc-900/90 backdrop-blur-xl border-l border-zinc-800/60 shadow-2xl
        transition-transform duration-300 ease-out
        ${isOpen ? 'translate-x-0' : 'translate-x-full'}
      `}
      style={{ top: 'var(--canvas-header-height, 44px)' }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-2">
          <span className="text-base">🤖</span>
          <h3 className="text-sm font-semibold text-zinc-200">AI 助手</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭 AI 助手"
          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <CloseIcon />
        </button>
      </div>

      {/* 对话区域 */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="flex flex-col items-center justify-center h-full text-center">
          <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
            <span className="text-2xl">💬</span>
          </div>
          <p className="text-sm text-zinc-400 max-w-[280px]">
            在画布模式下与 AI 助手对话，可使用 <span className="text-blue-400 font-medium">@</span> 引用画布上的图片
          </p>
          <p className="text-xs text-zinc-600 mt-2">即将上线</p>
        </div>
      </div>

      {/* 输入区 */}
      <div className="border-t border-zinc-800/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="输入消息..."
            className="flex-1 bg-zinc-800/60 border border-zinc-700/60 rounded-xl px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-blue-500/50 transition-colors"
          />
          <button
            type="button"
            aria-label="发送消息"
            className="p-2 rounded-xl bg-blue-500/80 text-white hover:bg-blue-500 transition-colors disabled:opacity-40"
            disabled={!inputValue.trim()}
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  )
})

// --- 内联图标 ---
function CloseIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
}
function SendIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" /></svg>
}
