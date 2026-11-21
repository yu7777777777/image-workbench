import { CanvasIcon } from './CanvasIcon'

export function CanvasToolbar(props: {
  tool: 'select' | 'hand'; scale: number; grid: boolean
  onTool: (tool: 'select' | 'hand') => void
  onZoom: (factor: number) => void; onFit: () => void; onFocus: () => void; onHelp: () => void; onGrid: () => void
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean
}) {
  return <div className="canvas-view-tools" data-canvas-ui>
    <button aria-label="选择工具" title="选择工具 (V)" className={props.tool === 'select' ? 'active' : ''} onClick={() => props.onTool('select')}><CanvasIcon name="select" /></button><button aria-label="平移工具" title="平移工具 (H)" className={props.tool === 'hand' ? 'active' : ''} onClick={() => props.onTool('hand')}><CanvasIcon name="hand" /></button><i />
    <button aria-label="撤销" title="撤销 (Ctrl+Z)" disabled={!props.canUndo} onClick={props.onUndo}><CanvasIcon name="undo" /></button><button aria-label="重做" title="重做 (Ctrl+Shift+Z)" disabled={!props.canRedo} onClick={props.onRedo}><CanvasIcon name="redo" /></button><i />
    <button aria-label="缩小" title="缩小" onClick={() => props.onZoom(1 / 1.2)}>−</button><span>{Math.round(props.scale * 100)}%</span><button aria-label="放大" title="放大" onClick={() => props.onZoom(1.2)}>+</button><button aria-label="聚焦选中节点" title="聚焦选中节点 (F)" onClick={props.onFocus}><CanvasIcon name="focus" /></button><button aria-label="适应画面" title="适应画面" onClick={props.onFit}><CanvasIcon name="fit" /></button><button aria-label="网格" title="网格" className={props.grid ? 'active' : ''} onClick={props.onGrid}><CanvasIcon name="grid" /></button><button aria-label="快捷键帮助" title="快捷键帮助 (?)" onClick={props.onHelp}><CanvasIcon name="help" /></button>
  </div>
}
