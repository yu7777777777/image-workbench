export const CANVAS_PROJECTS_CHANGED_EVENT = 'canvas-projects-changed'

export function notifyCanvasProjectsChanged(activeProjectId?: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CANVAS_PROJECTS_CHANGED_EVENT, { detail: { activeProjectId } }))
}
