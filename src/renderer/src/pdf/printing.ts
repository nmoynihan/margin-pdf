import { PRINT_SCALE, printPageSize, printPageTiles } from '../../../shared/limits'
import type { LoadedDocument } from './engine'

let owner: symbol | null = null

function loadPrintImage(image: HTMLImageElement, url: string, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => {
      image.onload = image.onerror = null
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(signal.reason)
    image.onload = () => finish()
    image.onerror = () => finish(new Error('Could not load a page image for printing.'))
    signal.addEventListener('abort', abort, { once: true })
    // Wait for the compressed image to load, without requesting eager decoding
    // of the entire document. Let Chromium manage its image cache for printing.
    image.decoding = 'async'
    image.src = url
  })
}

export async function preparePrint(
  loaded: LoadedDocument,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
) {
  if (owner) throw new Error('A print job is already active.')
  const job = Symbol('print job')
  owner = job
  const container = document.createElement('div')
  container.id = 'print-pages'
  container.dataset.documentId = loaded.descriptor.id
  document.body.append(container)
  const urls: string[] = []
  const style = document.createElement('style')
  document.head.append(style)
  let canvas: HTMLCanvasElement | undefined
  const cleanup = () => {
    if (owner !== job) return
    owner = null
    if (canvas) canvas.width = canvas.height = 0
    container.remove()
    style.remove()
    urls.forEach((url) => URL.revokeObjectURL(url))
    document.body.classList.remove('printing')
  }
  try {
    // Validate physical page boxes before allocating the scratch canvas. A long
    // document's combined raster area is not a reason to reject a print job.
    const sizes: { width: number; height: number }[] = []
    for (let number = 1; number <= loaded.pdf.numPages; number++) {
      signal.throwIfAborted()
      const page = await loaded.pdf.getPage(number)
      const points = page.getViewport({ scale: 1 })
      printPageSize(points.width, points.height)
      sizes.push({ width: points.width, height: points.height })
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    canvas = document.createElement('canvas')
    const rules: string[] = []
    for (let number = 1; number <= loaded.pdf.numPages; number++) {
      signal.throwIfAborted()
      const page = await loaded.pdf.getPage(number)
      const points = sizes[number - 1]
      const viewport = page.getViewport({ scale: PRINT_SCALE })
      const wrapper = document.createElement('div')
      wrapper.className = 'printed-page'
      wrapper.style.page = `pdf-page-${number}`
      wrapper.style.width = `${points.width}pt`
      wrapper.style.height = `${points.height}pt`
      rules.push(
        `@page pdf-page-${number} { size: ${points.width}pt ${points.height}pt; margin: 0; }`,
      )
      container.append(wrapper)
      for (const tile of printPageTiles(points.width, points.height)) {
        signal.throwIfAborted()
        canvas.width = tile.width
        canvas.height = tile.height
        const task = page.render({
          canvas,
          viewport,
          transform: [1, 0, 0, 1, -tile.x, -tile.y],
          intent: 'print',
        })
        const cancel = () => task.cancel()
        signal.addEventListener('abort', cancel, { once: true })
        let blob: Blob
        try {
          await task.promise
          signal.throwIfAborted()
          blob = await new Promise<Blob>((resolve, reject) =>
            canvas!.toBlob((value) =>
              value
                ? resolve(value)
                : reject(new Error('Could not prepare this page for printing.')),
            ),
          )
        } finally {
          signal.removeEventListener('abort', cancel)
          // Retain compressed PNGs, releasing the scratch raster after each tile.
          canvas.width = canvas.height = 0
        }
        signal.throwIfAborted()
        const image = new Image()
        image.style.left = `${tile.x / PRINT_SCALE}pt`
        image.style.top = `${tile.y / PRINT_SCALE}pt`
        image.style.width = `${tile.width / PRINT_SCALE}pt`
        image.style.height = `${tile.height / PRINT_SCALE}pt`
        const url = URL.createObjectURL(blob)
        urls.push(url)
        wrapper.append(image)
        await loadPrintImage(image, url, signal)
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      onProgress(number, loaded.pdf.numPages)
    }
    signal.throwIfAborted()
    style.textContent = rules.join('\n')
    document.body.classList.add('printing')
    return cleanup
  } catch (error) {
    cleanup()
    throw error
  }
}
