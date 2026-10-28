import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { DocumentDescriptor } from '../../../shared/types'
import { DestinationResolver } from './destinations'

GlobalWorkerOptions.workerSrc = workerURL
const assets = new URL('pdfjs/', document.baseURI).href

export interface LoadedDocument {
  descriptor: DocumentDescriptor
  pdf: PDFDocumentProxy
  resolver: DestinationResolver
  title: string
  outline: Awaited<ReturnType<PDFDocumentProxy['getOutline']>> | null
  labels: string[] | null
  destroy(): Promise<void>
}

export function startDocument(
  descriptor: DocumentDescriptor,
  onPassword: (submit: (password: string) => void, incorrect: boolean) => void,
) {
  let loadingTask: PDFDocumentLoadingTask | undefined
  let canceled = false
  const promise = (async (): Promise<LoadedDocument> => {
    const data = await window.desktop.readDocument(descriptor.id)
    if (canceled) throw new Error('Loading cancelled')
    loadingTask = getDocument({
      data: new Uint8Array(data),
      cMapUrl: `${assets}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assets}standard_fonts/`,
      wasmUrl: `${assets}wasm/`,
      iccUrl: `${assets}iccs/`,
      enableXfa: false,
    })
    loadingTask.onPassword = (submit: (value: string) => void, reason: number) =>
      onPassword(submit, reason === 2)
    const pdf = await loadingTask.promise
    const [metadata, outline, labels] = await Promise.allSettled([
      pdf.getMetadata(),
      pdf.getOutline(),
      pdf.getPageLabels(),
    ])
    const info =
      metadata.status === 'fulfilled' ? (metadata.value.info as { Title?: string }) : null
    const title = info?.Title?.trim() || descriptor.name.replace(/\.pdf$/i, '')
    const resolver = new DestinationResolver(pdf)
    return {
      descriptor,
      pdf,
      resolver,
      title,
      outline: outline.status === 'fulfilled' ? outline.value : null,
      labels: labels.status === 'fulfilled' ? labels.value : null,
      async destroy() {
        resolver.clear()
        await loadingTask?.destroy()
      },
    }
  })()
  return {
    promise,
    async cancel() {
      canceled = true
      await loadingTask?.destroy()
    },
  }
}
