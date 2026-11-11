import {
  getDocument,
  PDFWorker,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import { readerHost } from '../host'
import type { DocumentDescriptor } from '../../../shared/types'
import {
  LOAD_CONCURRENCY,
  MAX_DOCUMENT_BYTES,
  MAX_LOADED_BYTES,
  MAX_LOADED_DOCUMENTS,
  TaskGate,
} from '../../../shared/limits'
import { DestinationResolver } from './destinations'

const loads = new TaskGate(LOAD_CONCURRENCY)
let retainedBytes = 0
const retainedDocuments = new Map<string, number>()

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
  let workerResource: Awaited<ReturnType<ReturnType<typeof readerHost>['createWorker']>> | undefined
  let worker: PDFWorker | undefined
  const destroy = async () => {
    try {
      await loadingTask?.destroy()
    } finally {
      worker?.destroy()
      workerResource?.dispose()
      releaseBudget()
    }
  }
  const abort = new AbortController()
  let reserved = false
  let reservedBytes = descriptor.size
  const releaseBudget = () => {
    if (!reserved) return
    reserved = false
    retainedBytes -= reservedBytes
    const references = (retainedDocuments.get(descriptor.id) ?? 1) - 1
    if (references) retainedDocuments.set(descriptor.id, references)
    else retainedDocuments.delete(descriptor.id)
  }
  const promise = (async (): Promise<LoadedDocument> => {
    const release = await loads.acquire(abort.signal)
    try {
      abort.signal.throwIfAborted()
      if (descriptor.size > MAX_DOCUMENT_BYTES)
        throw new Error('PDFs larger than 128 MiB are not supported.')
      if (
        (!retainedDocuments.has(descriptor.id) && retainedDocuments.size >= MAX_LOADED_DOCUMENTS) ||
        retainedBytes + descriptor.size > MAX_LOADED_BYTES
      )
        throw new Error('The document loading budget is full. Close another paper and try again.')
      retainedBytes += descriptor.size
      // Stage a replacement for an existing tab without consuming a ninth tab slot.
      // Both versions still count against the actual aggregate byte budget.
      retainedDocuments.set(descriptor.id, (retainedDocuments.get(descriptor.id) ?? 0) + 1)
      reserved = true
      const host = readerHost()
      const data = await host.readDocument(descriptor.id)
      abort.signal.throwIfAborted()
      if (retainedBytes - reservedBytes + data.byteLength > MAX_LOADED_BYTES)
        throw new Error('The document loading budget is full. Close another paper and try again.')
      retainedBytes += data.byteLength - reservedBytes
      reservedBytes = data.byteLength
      // Explicit local worker avoids PDF.js's blob wrapper for custom app:// origins.
      workerResource = await host.createWorker()
      abort.signal.throwIfAborted()
      // @ts-expect-error PDF.js runtime accepts Worker; its constructor declaration infers null.
      worker = new PDFWorker({ port: workerResource.port })
      loadingTask = getDocument({
        worker,
        data,
        useWorkerFetch: host.useWorkerFetch,
        cMapUrl: host.assetUrl('cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: host.assetUrl('standard_fonts/'),
        wasmUrl: host.assetUrl('wasm/'),
        iccUrl: host.assetUrl('iccs/'),
        enableXfa: false,
        canvasMaxAreaInBytes: 32 * 1024 * 1024,
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
          await destroy()
        },
      }
    } catch (error) {
      await destroy()
      throw error
    } finally {
      release()
    }
  })()
  return {
    promise,
    async cancel() {
      abort.abort()
      await destroy()
    },
  }
}
