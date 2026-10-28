import type { ReadingPosition, PaneSnapshot } from '../../../shared/types'

function samePosition(a: ReadingPosition, b: ReadingPosition) {
  return (
    a.page === b.page &&
    Math.abs(a.top - b.top) < 2 &&
    Math.abs(a.left - b.left) < 2 &&
    a.zoom === b.zoom &&
    a.rotation === b.rotation
  )
}

export class NavigationHistory {
  private past: ReadingPosition[] = []
  private future: ReadingPosition[] = []
  get canGoBack() {
    return this.past.length > 0
  }
  get canGoForward() {
    return this.future.length > 0
  }
  checkpoint(position: ReadingPosition) {
    if (!this.past.length || !samePosition(this.past.at(-1)!, position))
      this.past.push({ ...position })
    if (this.past.length > 100) this.past.shift()
    this.future = []
  }
  back(current: ReadingPosition) {
    const target = this.past.pop()
    if (target) this.future.push({ ...current })
    return target
  }
  forward(current: ReadingPosition) {
    const target = this.future.pop()
    if (target) this.past.push({ ...current })
    return target
  }
}

export function oppositePane(
  panes: PaneSnapshot[],
  sourceId: string,
  newId: string,
): { panes: PaneSnapshot[]; targetId: string } {
  const source = panes.find((pane) => pane.id === sourceId)
  if (!source) throw new Error('Source pane is no longer open.')
  const other = panes.find((pane) => pane.id !== sourceId)
  if (other) return { panes, targetId: other.id }
  return { panes: [...panes, { id: newId, position: { ...source.position } }], targetId: newId }
}

export function placePreview(
  anchor: { left: number; right: number; top: number; bottom: number },
  viewport: { width: number; height: number },
  size = { width: 560, height: 430 },
) {
  const width = Math.min(size.width, viewport.width - 24)
  const height = Math.min(size.height, viewport.height - 24)
  const below = anchor.bottom + 10
  const top = below + height <= viewport.height - 12 ? below : anchor.top - height - 10
  return {
    left: Math.max(12, Math.min(anchor.left, viewport.width - width - 12)),
    top: Math.max(12, Math.min(top, viewport.height - height - 12)),
    width,
    height,
  }
}
