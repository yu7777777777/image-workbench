import { memo, useCallback, useRef, useState } from 'react'

interface ComparisonSliderProps {
  beforeSrc: string
  afterSrc: string
  beforeLabel?: string
  afterLabel?: string
  width?: number | string
  height?: number | string
  className?: string
}

export const ComparisonSlider = memo(function ComparisonSlider({
  beforeSrc,
  afterSrc,
  beforeLabel = 'Before',
  afterLabel = 'After',
  width = '100%',
  height = 300,
  className = '',
}: ComparisonSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(50) // 百分比位置
  const isDraggingRef = useRef(false)

  const updatePosition = useCallback((clientX: number) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const x = clientX - rect.left
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100))
    setPosition(pct)
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    updatePosition(e.clientX)
  }, [updatePosition])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    updatePosition(e.clientX)
  }, [updatePosition])

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false
  }, [])

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-2xl select-none cursor-col-resize touch-none ${className}`}
      style={{ width, height }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* After (底层) */}
      <img
        src={afterSrc}
        alt={afterLabel}
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
      />

      {/* Before (裁剪层) */}
      <img
        src={beforeSrc}
        alt={beforeLabel}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        draggable={false}
      />

      {/* 分割线 */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white/80 shadow-[0_0_8px_rgba(0,0,0,0.5)]"
        style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
      >
        {/* 拖拽手柄 */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 shadow-lg flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#333" className="w-4 h-4">
            <path fillRule="evenodd" d="M6.28 10.53a.75.75 0 0 1 0-1.06l3-3a.75.75 0 1 1 1.06 1.06L8.56 9.25h2.88l-1.78-1.72a.75.75 0 0 1 1.06-1.06l3 3a.75.75 0 0 1 0 1.06l-3 3a.75.75 0 1 1-1.06-1.06l1.78-1.72H8.56l1.78 1.72a.75.75 0 1 1-1.06 1.06l-3-3Z" clipRule="evenodd" />
          </svg>
        </div>
      </div>

      {/* 标签 */}
      <div className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-black/50 text-xs text-white/80 backdrop-blur-sm">
        {beforeLabel}
      </div>
      <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/50 text-xs text-white/80 backdrop-blur-sm">
        {afterLabel}
      </div>
    </div>
  )
})
