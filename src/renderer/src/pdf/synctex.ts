import type { SyncTarget } from '../../../shared/reader-host'

interface Viewport {
  viewBox: number[]
  width: number
  height: number
  convertToPdfPoint(x: number, y: number): number[]
  convertToViewportPoint(x: number, y: number): number[]
}

export function pdfPointFromTopLeft(box: number[], x: number, y: number): [number, number] {
  return [box[0] + x, box[3] - y]
}

export function pagePointFromClient(
  viewport: Viewport,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
) {
  const [x, y] = viewport.convertToPdfPoint(
    ((clientX - rect.left) * viewport.width) / rect.width,
    ((clientY - rect.top) * viewport.height) / rect.height,
  )
  return { x, y: viewport.viewBox[3] - y, viewBox: viewport.viewBox }
}

export function viewportRectFromTarget(viewport: Viewport, target: SyncTarget) {
  const [x, y] = pdfPointFromTopLeft(target.pageBox ?? viewport.viewBox, target.x, target.y)
  const [x1, y1] = viewport.convertToViewportPoint(x, y - target.height)
  const [x2, y2] = viewport.convertToViewportPoint(x + target.width, y)
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.max(4, Math.abs(x2 - x1)),
    height: Math.max(4, Math.abs(y2 - y1)),
  }
}
