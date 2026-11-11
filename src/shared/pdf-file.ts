import { open, stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { LOAD_CONCURRENCY, MAX_DOCUMENT_BYTES, TaskGate } from './limits'
import type { DocumentDescriptor } from './types'

const reads = new TaskGate(LOAD_CONCURRENCY)

export async function describePdf(path: string, id: string): Promise<DocumentDescriptor> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error('This PDF is no longer available.')
  if (info.size > MAX_DOCUMENT_BYTES) throw new Error('PDFs larger than 128 MiB are not supported.')
  return {
    id,
    name: basename(path),
    location: basename(dirname(path)),
    size: info.size,
    modified: info.mtimeMs,
    revision: `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`,
  }
}

export async function readPdf(path: string) {
  const release = await reads.acquire()
  try {
    const file = await open(path, 'r')
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > MAX_DOCUMENT_BYTES)
        throw new Error('PDFs larger than 128 MiB are not supported.')
      const data = Buffer.alloc(info.size)
      let offset = 0
      while (offset < data.length) {
        const { bytesRead } = await file.read(data, offset, data.length - offset, offset)
        if (!bytesRead) break
        offset += bytesRead
      }
      return data.subarray(0, offset)
    } finally {
      await file.close()
    }
  } finally {
    release()
  }
}
