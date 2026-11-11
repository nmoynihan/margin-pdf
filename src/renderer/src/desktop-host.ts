import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { ReaderHost } from '../../shared/reader-host'

export function createDesktopHost(): ReaderHost {
  return {
    readDocument: (id) => window.desktop.readDocument(id),
    assetUrl: (path) => new URL(`pdfjs/${path}`, document.baseURI).href,
    createWorker: async () => {
      const port = new Worker(workerURL, { type: 'module' })
      return { port, dispose: () => port.terminate() }
    },
    openExternal: (url) => window.desktop.openExternal(url),
    toggleFullscreen: () => window.desktop.toggleFullscreen(),
    restart: () => window.desktop.restart(true),
  }
}
