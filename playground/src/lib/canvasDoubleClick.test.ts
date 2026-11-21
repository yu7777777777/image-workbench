import { describe, expect, it } from 'vitest'
import workspaceSource from '../components/CanvasWorkspace.tsx?raw'
import cardSource from '../components/canvas/CanvasNodeCard.tsx?raw'

// 画布节点双击放大的回归护栏。
//
// 浏览器规则：pointerdown 里调用 preventDefault()，或在该阶段 setPointerCapture
// 把指针交给别的元素，都会让后续 dblclick 的目标不再是原节点，
// 导致 CanvasNodeCard 上的 onDoubleClick 永远收不到事件。

const sliceBetween = (source: string, from: string, to: string) =>
  source.slice(source.indexOf(from), source.indexOf(to))

const pointerDownBody = sliceBetween(workspaceSource, 'const pointerDown = ', 'const pointerMove = ')

describe('canvas node double-click guards', () => {
  it('does not call preventDefault inside pointerDown', () => {
    expect(/^\s*(event|e)\.preventDefault\(\)/m.test(pointerDownBody)).toBe(false)
  })

  it('does not capture the pointer eagerly on single-pointer node down', () => {
    // 合法捕获只允许出现在两处：双指捏合（pointers.size === 2）和平移（pan）分支。
    // 单指按在节点上的路径必须保持「不捕获」，否则第二次点击会被重定向到 viewport，
    // dblclick 目标不再是节点，双击放大失效。
    const pinchBlock = sliceBetween(pointerDownBody, 'pointers.current.size === 2', 'const pan =')
    const panBlock = sliceBetween(pointerDownBody, 'if (pan) {', 'if (nodeId) {')
    const nodeBlock = pointerDownBody.slice(pointerDownBody.indexOf('if (nodeId) {'))
    expect(pinchBlock).toContain('setPointerCapture')
    expect(panBlock).toContain('startCapture()')
    // 节点手势分支里不得有任何捕获动作
    expect(nodeBlock.includes('setPointerCapture')).toBe(false)
    expect(nodeBlock.includes('startCapture()')).toBe(false)
  })

  it('captures the pointer only after the drag threshold is crossed', () => {
    const pointerMoveBody = sliceBetween(workspaceSource, 'const pointerMove = ', 'const pointerUp = ')
    expect(pointerMoveBody).toMatch(/if \(!active\.moved\) \{ capture\(\);/)
  })

  it('keeps the image node wired to the preview handler', () => {
    expect(cardSource).toContain('onDoubleClick')
    expect(workspaceSource).toContain('onDoubleClick={preview}')
  })

  it('opens the lightbox instead of only opening a tab for cached images', () => {
    const previewBody = sliceBetween(workspaceSource, 'const preview = ', 'const connect = ')
    expect(previewBody).toContain('setLightboxImageId')
  })
})
