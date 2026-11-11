// Input and raster budgets, not estimates of PDF.js's total memory use.
export const MAX_DOCUMENT_BYTES = 128 * 1024 * 1024
export const MAX_LOADED_BYTES = 256 * 1024 * 1024
export const MAX_LOADED_DOCUMENTS = 8
export const LOAD_CONCURRENCY = 2
export const MAX_PAGE_PIXELS = 8 * 1024 * 1024
export const MAX_CANVAS_DIMENSION = 8192
export const PRINT_SCALE = 150 / 72
export const MAX_PRINT_PAGE_POINTS = 200 * 72

export function printPageSize(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_PRINT_PAGE_POINTS ||
    height > MAX_PRINT_PAGE_POINTS
  )
    throw new Error('This PDF page has invalid print dimensions (maximum 200 inches per side).')
  const pixelsWide = Math.ceil(width * PRINT_SCALE)
  const pixelsHigh = Math.ceil(height * PRINT_SCALE)
  const pixels = pixelsWide * pixelsHigh
  return { width: pixelsWide, height: pixelsHigh, pixels }
}

// Bound the working canvas, rather than the number or combined area of PDF pages.
// Tiles remain at 150 DPI even for large paper sizes such as A0.
export function* printPageTiles(width: number, height: number) {
  const size = printPageSize(width, height)
  const tileWidth = Math.min(size.width, MAX_CANVAS_DIMENSION)
  const tileHeight = Math.min(MAX_CANVAS_DIMENSION, Math.floor(MAX_PAGE_PIXELS / tileWidth))
  for (let y = 0; y < size.height; y += tileHeight)
    for (let x = 0; x < size.width; x += tileWidth)
      yield {
        x,
        y,
        width: Math.min(tileWidth, size.width - x),
        height: Math.min(tileHeight, size.height - y),
      }
}

export class TaskGate {
  private active = 0
  private waiting: Array<() => void> = []

  constructor(private readonly concurrency: number) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        this.waiting = this.waiting.filter((entry) => entry !== run)
        reject(signal?.reason)
      }
      const run = () => {
        signal?.removeEventListener('abort', abort)
        this.active++
        resolve()
      }
      if (this.active < this.concurrency) run()
      else {
        this.waiting.push(run)
        signal?.addEventListener('abort', abort, { once: true })
      }
    })
    let released = false
    return () => {
      if (released) return
      released = true
      this.active--
      this.waiting.shift()?.()
    }
  }
}
