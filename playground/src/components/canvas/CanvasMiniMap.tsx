import { useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasNode } from '../../types'
import type { CanvasTransform } from '../../lib/canvasTransform'

interface CanvasMiniMapProps {
  nodes: CanvasNode[]
  transform: CanvasTransform
  onNavigate: (world: { x: number; y: number }) => void
}

const WIDTH = 190
const HEIGHT = 126
const PAD = 12

export function CanvasMiniMap({ nodes, transform, onNavigate }: CanvasMiniMapProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [viewportSize, setViewportSize] = useState({ width: 1000, height: 700 })
  useEffect(() => {
    const element = ref.current?.parentElement
    if (!element || typeof ResizeObserver === 'undefined') return
    const update = () => setViewportSize({ width: element.clientWidth, height: element.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const bounds = useMemo(() => {
    if (!nodes.length) return { x: -200, y: -140, width: 400, height: 280 }
    const x = Math.min(...nodes.map((node) => node.position.x))
    const y = Math.min(...nodes.map((node) => node.position.y))
    const right = Math.max(...nodes.map((node) => node.position.x + node.width))
    const bottom = Math.max(...nodes.map((node) => node.position.y + node.height))
    return { x: x - 120, y: y - 100, width: Math.max(400, right - x + 240), height: Math.max(280, bottom - y + 200) }
  }, [nodes])
  const scale = Math.min((WIDTH - PAD * 2) / bounds.width, (HEIGHT - PAD * 2) / bounds.height)
  const point = (x: number, y: number) => ({ x: PAD + (x - bounds.x) * scale, y: PAD + (y - bounds.y) * scale })
  const visible = {
    x: -transform.x / transform.scale,
    y: -transform.y / transform.scale,
    width: viewportSize.width / transform.scale,
    height: viewportSize.height / transform.scale,
  }
  const visibleTopLeft = point(visible.x, visible.y)
  const visibleBottomRight = point(visible.x + visible.width, visible.y + visible.height)

  return <div ref={ref} className="canvas-minimap" data-canvas-ui>
    <div className="canvas-minimap-title">画布导航</div>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="画布小地图"
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const x = bounds.x + (((event.clientX - rect.left) / rect.width) * WIDTH - PAD) / scale
        const y = bounds.y + (((event.clientY - rect.top) / rect.height) * HEIGHT - PAD) / scale
        onNavigate({ x, y })
      }}>
      <rect width={WIDTH} height={HEIGHT} rx="10" className="canvas-minimap-bg" />
      {nodes.map((node) => {
        const start = point(node.position.x, node.position.y)
        return <rect key={node.id} x={start.x} y={start.y} width={Math.max(3, node.width * scale)} height={Math.max(3, node.height * scale)} rx="2" className={`canvas-minimap-node ${node.type === 'generation' ? 'is-generation' : ''}`} />
      })}
      <rect x={visibleTopLeft.x} y={visibleTopLeft.y} width={Math.max(10, visibleBottomRight.x - visibleTopLeft.x)} height={Math.max(10, visibleBottomRight.y - visibleTopLeft.y)} className="canvas-minimap-viewport" />
    </svg>
  </div>
}
