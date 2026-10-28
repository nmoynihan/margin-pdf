import type { LoadedDocument } from './engine'

export async function preparePrint(
  loaded: LoadedDocument,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
) {
  const container = document.createElement('div')
  container.id = 'print-pages'
  document.body.append(container)
  const urls: string[] = []
  const style = document.createElement('style')
  document.head.append(style)
  const cleanup = () => {
    container.remove()
    style.remove()
    urls.forEach((url) => URL.revokeObjectURL(url))
    document.body.classList.remove('printing')
  }
  try {
    for (let number = 1; number <= loaded.pdf.numPages; number++) {
      signal.throwIfAborted()
      const page = await loaded.pdf.getPage(number)
      signal.throwIfAborted()
      const viewport = page.getViewport({ scale: 150 / 72 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const task = page.render({ canvas, viewport, intent: 'print' })
      const cancel = () => task.cancel()
      signal.addEventListener('abort', cancel, { once: true })
      try {
        await task.promise
      } finally {
        signal.removeEventListener('abort', cancel)
      }
      signal.throwIfAborted()
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) =>
          value ? resolve(value) : reject(new Error('Could not prepare this page for printing.')),
        ),
      )
      canvas.width = canvas.height = 0
      signal.throwIfAborted()
      const image = new Image()
      const url = URL.createObjectURL(blob)
      urls.push(url)
      image.src = url
      await image.decode()
      const points = page.getViewport({ scale: 1 })
      const wrapper = document.createElement('div')
      wrapper.className = 'printed-page'
      wrapper.style.page = `pdf-page-${number}`
      wrapper.style.width = `${points.width}pt`
      wrapper.style.height = `${points.height}pt`
      style.textContent += `@page pdf-page-${number} { size: ${points.width}pt ${points.height}pt; margin: 0; }\n`
      wrapper.append(image)
      container.append(wrapper)
      onProgress(number, loaded.pdf.numPages)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    signal.throwIfAborted()
    document.body.classList.add('printing')
    return cleanup
  } catch (error) {
    cleanup()
    throw error
  }
}
