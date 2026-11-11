import type { DocumentDescriptor, TabSnapshot } from '../../../src/shared/types'
import { MAX_DOCUMENT_BYTES } from '../../../src/shared/limits'

export interface BrowserDocument {
  descriptor: DocumentDescriptor
  bytes: Uint8Array<ArrayBuffer>
  initial?: TabSnapshot
  native: boolean
}

export function pdfName(url: string): string {
  try {
    const parsed = new URL(url)
    if (!['https:', 'http:', 'file:'].includes(parsed.protocol)) return 'Document.pdf'
    const name = decodeURIComponent(parsed.pathname.split('/').pop() || '').slice(0, 255)
    return name || 'Document.pdf'
  } catch {
    return 'Document.pdf'
  }
}

export function pageFromHash(hash: string): number | undefined {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('page')
  return value && /^\d+$/.test(value) && Number(value) > 0
    ? Math.min(Number(value), 1_000_000)
    : undefined
}

export async function readPdfResponse(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok) throw new Error(`Could not open this PDF (HTTP ${response.status}).`)
  if (Number(response.headers.get('content-length')) > MAX_DOCUMENT_BYTES) {
    await response.body?.cancel()
    throw new Error('PDFs larger than 128 MiB are not supported.')
  }
  if (!response.body) throw new Error('This PDF has no readable content.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_DOCUMENT_BYTES) {
        await reader.cancel()
        throw new Error('PDFs larger than 128 MiB are not supported.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function describeBytes(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
  location: string,
): Promise<DocumentDescriptor> {
  if (bytes.byteLength > MAX_DOCUMENT_BYTES)
    throw new Error('PDFs larger than 128 MiB are not supported.')
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return {
    id: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    name,
    location,
    size: bytes.byteLength,
    modified: 0,
  }
}
