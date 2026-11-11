/** Coordinates are in unrotated page points, measured from the top-left. */
export interface PdfPoint {
  page: number
  x: number
  y: number
  viewBox?: number[]
}

export interface SyncTarget extends PdfPoint {
  requestId: number
  width: number
  height: number
  pageBox?: number[]
}

export interface ReaderHost {
  readDocument(id: string): Promise<Uint8Array>
  assetUrl(path: string): string
  createWorker(): Promise<{ port: Worker; dispose(): void }>
  useWorkerFetch?: boolean
  openExternal(url: string): Promise<void>
  toggleFullscreen?: () => Promise<void>
  restart?: () => Promise<void>
  syncToSource?: (documentId: string, point: PdfPoint) => Promise<void>
}
