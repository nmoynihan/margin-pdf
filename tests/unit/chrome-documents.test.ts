import { describe, expect, it } from 'vitest'
import {
  describeBytes,
  pageFromHash,
  pdfName,
  readPdfResponse,
} from '../../extensions/chrome/src/documents'
import { MAX_DOCUMENT_BYTES } from '../../src/shared/limits'

describe('Chrome document input', () => {
  it('reads streamed PDFs and rejects HTTP errors', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nexample')
    expect(await readPdfResponse(new Response(bytes))).toEqual(bytes)
    await expect(readPdfResponse(new Response('', { status: 403 }))).rejects.toThrow('HTTP 403')
  })

  it('cancels over-budget responses before reading or retaining their body', async () => {
    let cancelled = false
    const response = new Response(
      new ReadableStream({
        cancel: () => {
          cancelled = true
        },
      }),
      {
        headers: { 'content-length': String(MAX_DOCUMENT_BYTES + 1) },
      },
    )
    await expect(readPdfResponse(response)).rejects.toThrow('128 MiB')
    expect(cancelled).toBe(true)
  })

  it('enforces the byte limit even without an honest content length', async () => {
    let cancelled = false
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_DOCUMENT_BYTES))
          controller.enqueue(new Uint8Array(1))
        },
        cancel: () => {
          cancelled = true
        },
      }),
    )
    await expect(readPdfResponse(response)).rejects.toThrow('128 MiB')
    expect(cancelled).toBe(true)
  })

  it('uses only document bytes for the saved-position identifier', async () => {
    const bytes = new TextEncoder().encode('%PDF-sample')
    const a = await describeBytes(bytes, 'secret-name.pdf', 'private.example')
    const b = await describeBytes(bytes, 'other-name.pdf', 'different.example')
    expect(a.id).toMatch(/^[a-f0-9]{64}$/)
    expect(a.id).toBe(b.id)
    expect((await describeBytes(new Uint8Array([1]), '', '')).id).not.toBe(a.id)
  })

  it('honours valid page fragments without accepting arbitrary zoom/code', () => {
    expect(pageFromHash('#page=4&zoom=100')).toBe(4)
    for (const hash of ['#page=0', '#page=-1', '#page=NaN', '#page=1.5', '#page=alert(1)'])
      expect(pageFromHash(hash)).toBeUndefined()
  })

  it('extracts display names without exposing query tokens', () => {
    expect(pdfName('https://example.test/paper%20one.pdf?token=secret')).toBe('paper one.pdf')
    expect(pdfName('https://example.test/')).toBe('Document.pdf')
    expect(pdfName('broken-url')).toBe('Document.pdf')
  })
})
