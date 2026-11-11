import type { DocumentChange, DocumentDescriptor, TabSnapshot } from './types'
import type { PdfPoint, SyncTarget } from './reader-host'

export interface ReaderState {
  snapshot: TabSnapshot
  sidebar: 'outline' | 'thumbnails' | null
}

export interface WebviewRequests {
  bootstrap: { args: undefined; result: { descriptor: DocumentDescriptor; state?: ReaderState } }
  read: { args: undefined; result: string }
  save: { args: ReaderState; result: undefined }
  external: { args: string; result: undefined }
  reverse: { args: PdfPoint; result: undefined }
  close: { args: undefined; result: undefined }
}

export type HostMessage =
  | { type: 'result'; id: number; value?: unknown; error?: string }
  | { type: 'change'; change: DocumentChange }
  | { type: 'sync'; target: SyncTarget }
  | { type: 'probe'; id: number; action?: string; value?: unknown }

export type WebviewMessage =
  | { type: 'request'; id: number; method: keyof WebviewRequests; args?: unknown }
  | { type: 'ready' }
  | { type: 'probe-result'; id: number; value: unknown }
