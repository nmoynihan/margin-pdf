import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

export type Destination = string | unknown[]
export interface ResolvedDestination {
  pageNumber: number
  explicit: unknown[]
  x: number | null
  y: number | null
}

const coordinate = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export async function resolveDestination(
  document: Pick<PDFDocumentProxy, 'getDestination' | 'getPageIndex' | 'numPages'>,
  destination: Destination,
): Promise<ResolvedDestination> {
  const explicit =
    typeof destination === 'string' ? await document.getDestination(destination) : destination
  if (!Array.isArray(explicit) || explicit.length < 2)
    throw new Error('This link has no available destination.')
  const ref = explicit[0]
  let index: number
  if (Number.isInteger(ref)) index = ref as number
  else if (ref && typeof ref === 'object' && Number.isInteger(ref.num) && Number.isInteger(ref.gen))
    index = await document.getPageIndex(ref)
  else throw new Error('This link points to an invalid page.')
  if (!Number.isInteger(index) || index < 0 || index >= document.numPages)
    throw new Error('This link points outside the document.')
  const mode = explicit[1]?.name
  if (!['XYZ', 'Fit', 'FitB', 'FitH', 'FitBH', 'FitV', 'FitBV', 'FitR'].includes(mode))
    throw new Error('This destination type is not supported.')
  const optionalCoordinate = (value: unknown) => value === null || coordinate(value) !== null
  if (
    mode === 'XYZ' &&
    (explicit.length < 5 ||
      !explicit.slice(2, 5).every(optionalCoordinate) ||
      (coordinate(explicit[4]) ?? 0) < 0)
  )
    throw new Error('This link has invalid destination coordinates.')
  if (
    ['FitH', 'FitBH', 'FitV', 'FitBV'].includes(mode) &&
    (explicit.length < 3 || !optionalCoordinate(explicit[2]))
  )
    throw new Error('This link has invalid destination coordinates.')
  let x: number | null = null
  let y: number | null = null
  if (mode === 'XYZ') {
    x = coordinate(explicit[2])
    y = coordinate(explicit[3])
  }
  if (mode === 'FitH' || mode === 'FitBH') y = coordinate(explicit[2])
  if (mode === 'FitV' || mode === 'FitBV') x = coordinate(explicit[2])
  if (mode === 'FitR') {
    const values = explicit.slice(2, 6).map(coordinate)
    if (values.length !== 4 || values.some((value) => value === null))
      throw new Error('This link has an invalid target area.')
    x = Math.min(values[0]!, values[2]!)
    y = Math.max(values[1]!, values[3]!)
  }
  return { pageNumber: index + 1, explicit, x, y }
}

export function previewPoint(
  destination: ResolvedDestination,
  page: Pick<PDFPageProxy, 'view'>,
  viewport: { convertToViewportPoint(x: number, y: number): number[] },
) {
  const [left, top] = viewport.convertToViewportPoint(
    destination.x ?? page.view[0],
    destination.y ?? page.view[3],
  )
  return { left: Math.max(0, left - 24), top: Math.max(0, top - 32) }
}

export class DestinationResolver {
  private cache = new Map<string, Promise<ResolvedDestination>>()
  constructor(private document: PDFDocumentProxy) {}
  resolve(destination: Destination) {
    const key = JSON.stringify(destination)
    const existing = this.cache.get(key)
    if (existing) return existing
    const promise = resolveDestination(this.document, destination)
    this.cache.set(key, promise)
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!)
    promise.catch(() => this.cache.delete(key))
    return promise
  }
  clear() {
    this.cache.clear()
  }
}
