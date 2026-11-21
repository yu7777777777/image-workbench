import { memo } from 'react'
import { getGridSpacing, type CanvasTransform } from '../../lib/canvasTransform'

interface CanvasGridProps {
  transform: CanvasTransform
  visible: boolean
}

export const CanvasGrid = memo(function CanvasGrid({ transform, visible }: CanvasGridProps) {
  if (!visible) return null

  const { spacing, opacity } = getGridSpacing(transform.scale)

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: `radial-gradient(circle, oklch(1 0 0 / ${opacity}) 1px, transparent 1px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${transform.x % spacing}px ${transform.y % spacing}px`,
      }}
    />
  )
})
