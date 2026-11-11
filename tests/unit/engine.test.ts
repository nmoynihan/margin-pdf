import { configureReaderHost } from '../../src/renderer/src/host'
import { createDesktopHost } from '../../src/renderer/src/desktop-host'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DocumentDescriptor } from '../../src/shared/types'

vi.mock('pdfjs-dist', () => ({
  PDFWorker: class {
    destroy() {}
  },
  getDocument: () => ({
    promise: Promise.resolve({
      getMetadata: async () => ({ info: {} }),
      getOutline: async () => [],
      getPageLabels: async () => null,
    }),
    destroy: async () => {},
  }),
}))
let startDocument: (typeof import('../../src/renderer/src/pdf/engine'))['startDocument']
const descriptor = (id: number): DocumentDescriptor => ({
  id: String(id),
  name: `${id}.pdf`,
  location: 'fixture',
  size: 10,
  modified: 0,
})
beforeAll(async () => {
  vi.stubGlobal('document', { baseURI: 'app://reader/index.html' })
  vi.stubGlobal(
    'Worker',
    class {
      terminate() {}
    },
  )
  configureReaderHost(createDesktopHost())
  ;({ startDocument } = await import('../../src/renderer/src/pdf/engine'))
})
afterAll(() => vi.unstubAllGlobals())

describe('document loading admission', () => {
  it('never reads more than two documents concurrently, including cancelled queued loads', async () => {
    const reads: Array<() => void> = []
    let active = 0,
      peak = 0
    vi.stubGlobal('window', {
      desktop: {
        readDocument: vi.fn(
          () =>
            new Promise<Uint8Array>((resolve) => {
              active++
              peak = Math.max(peak, active)
              reads.push(() => {
                active--
                resolve(new Uint8Array(10))
              })
            }),
        ),
      },
    })
    const tasks = [1, 2, 3, 4].map((id) => startDocument(descriptor(id), () => {}))
    const cancelled = expect(tasks[2].promise).rejects.toThrow()
    await tasks[2].cancel()
    await cancelled
    await vi.waitFor(() => expect(reads).toHaveLength(2))
    reads[0]()
    await vi.waitFor(() => expect(reads).toHaveLength(3))
    reads[1]()
    reads[2]()
    const loaded = await Promise.all([tasks[0].promise, tasks[1].promise, tasks[3].promise])
    expect(peak).toBe(2)
    expect(window.desktop.readDocument).toHaveBeenCalledTimes(3)
    await Promise.all(loaded.map((document) => document.destroy()))
  })

  it('caps retained documents and releases capacity on close', async () => {
    vi.stubGlobal('window', { desktop: { readDocument: vi.fn(async () => new Uint8Array(10)) } })
    const loaded = []
    for (let id = 0; id < 8; id++)
      loaded.push(await startDocument(descriptor(id), () => {}).promise)
    await expect(startDocument(descriptor(9), () => {}).promise).rejects.toThrow('budget is full')
    expect(window.desktop.readDocument).toHaveBeenCalledTimes(8)
    const refreshed = await startDocument(descriptor(0), () => {}).promise
    await loaded[0].destroy()
    loaded[0] = refreshed
    await expect(startDocument(descriptor(9), () => {}).promise).rejects.toThrow('budget is full')
    await loaded.pop()!.destroy()
    loaded.push(await startDocument(descriptor(10), () => {}).promise)
    await Promise.all(loaded.map((document) => document.destroy()))
  })
})

it('enforces the aggregate byte budget without allocating oversized buffers', async () => {
  const size = 100 * 1024 * 1024
  vi.stubGlobal('window', { desktop: { readDocument: vi.fn(async () => ({ byteLength: size })) } })
  // The mocked parser does not need actual bytes to test the admission boundary.
  const first = await startDocument({ ...descriptor(1), size }, () => {}).promise
  const second = await startDocument({ ...descriptor(2), size }, () => {}).promise
  await expect(startDocument({ ...descriptor(3), size }, () => {}).promise).rejects.toThrow(
    'budget is full',
  )
  expect(window.desktop.readDocument).toHaveBeenCalledTimes(2)
  await first.destroy()
  const third = await startDocument({ ...descriptor(3), size }, () => {}).promise
  await Promise.all([second.destroy(), third.destroy()])
})
