import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { ReaderHost } from '../../../src/shared/reader-host'
import { chromeAPI } from './chrome'
import type { BrowserDocument } from './documents'

let current: BrowserDocument | undefined
export function setCurrentDocument(value: BrowserDocument | undefined) {
  current = value
}

export const browserHost: ReaderHost = {
  readDocument: async (id) => {
    if (!current || current.descriptor.id !== id) throw new Error('Please reopen this PDF.')
    // PDF.js transfers this copy to its worker. Retain the source for retry and download.
    return current.bytes.slice()
  },
  assetUrl: (path) => chromeAPI.runtime.getURL(`pdfjs/${path}`),
  createWorker: async () => {
    const port = new Worker(workerURL, { type: 'module' })
    return { port, dispose: () => port.terminate() }
  },
  openExternal: async (url) => {
    if (!['https:', 'http:', 'mailto:'].includes(new URL(url).protocol))
      throw new Error('This link type is not supported.')
    await chromeAPI.tabs.create({ url })
  },
  toggleFullscreen: async () => {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  },
}
