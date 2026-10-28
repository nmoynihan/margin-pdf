import { describe, expect, it, vi } from 'vitest'
import {
  resolveDestination,
  previewPoint,
  DestinationResolver,
} from '../../src/renderer/src/pdf/destinations'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

const doc = () => ({
  numPages: 5,
  getDestination: vi.fn(async () => [{ num: 8, gen: 0 }, { name: 'XYZ' }, 310, 630, 2]),
  getPageIndex: vi.fn(async () => 3),
})
describe('PDF destinations', () => {
  it('resolves named destinations through page references and retains their coordinates', async () => {
    const document = doc()
    expect(
      await resolveDestination(document as unknown as PDFDocumentProxy, 'reference'),
    ).toMatchObject({ pageNumber: 4, x: 310, y: 630 })
    expect(document.getDestination).toHaveBeenCalledWith('reference')
    expect(document.getPageIndex).toHaveBeenCalledWith({ num: 8, gen: 0 })
  })
  it.each([
    ['Fit', null, null],
    ['FitB', null, null],
    ['FitH', null, 700],
    ['FitBH', null, 700],
    ['FitV', 700, null],
    ['FitBV', 700, null],
  ])('supports %s', async (mode, x, y) => {
    expect(
      await resolveDestination(doc() as unknown as PDFDocumentProxy, [1, { name: mode }, 700]),
    ).toMatchObject({ pageNumber: 2, x, y })
  })
  it('uses the upper left corner of a fit rectangle', async () => {
    expect(
      await resolveDestination(doc() as unknown as PDFDocumentProxy, [
        0,
        { name: 'FitR' },
        320,
        200,
        50,
        600,
      ]),
    ).toMatchObject({ x: 50, y: 600 })
  })
  it.each([
    [-1, { name: 'Fit' }],
    [5, { name: 'Fit' }],
    [0, { name: 'Unknown' }],
    [null, { name: 'Fit' }],
    [0, { name: 'FitR' }, 0],
    [],
  ])('rejects invalid destinations: %j', async (...destination) => {
    await expect(
      resolveDestination(doc() as unknown as PDFDocumentProxy, destination),
    ).rejects.toThrow()
  })
  it('rejects a missing named destination', async () => {
    const document = { ...doc(), getDestination: vi.fn(async () => null) }
    await expect(
      resolveDestination(document as unknown as PDFDocumentProxy, 'missing'),
    ).rejects.toThrow('no available')
  })
  it('rejects malformed coordinates before a viewer can navigate', async () => {
    await expect(
      resolveDestination(doc() as unknown as PDFDocumentProxy, [
        0,
        { name: 'XYZ' },
        'bad',
        100,
        null,
      ]),
    ).rejects.toThrow('coordinates')
    await expect(
      resolveDestination(doc() as unknown as PDFDocumentProxy, [0, { name: 'FitH' }]),
    ).rejects.toThrow('coordinates')
    await expect(
      resolveDestination(doc() as unknown as PDFDocumentProxy, [0, { name: 'XYZ' }, 0, 100, -1]),
    ).rejects.toThrow('coordinates')
  })
  it('uses the page crop box for a coordinate-free destination and respects viewport rotation', () => {
    const page = { view: [20, 30, 620, 830] } as PDFPageProxy
    const convertToViewportPoint = vi.fn((x: number, y: number) => [y, x])
    expect(
      previewPoint({ pageNumber: 1, explicit: [], x: null, y: null }, page, {
        convertToViewportPoint,
      }),
    ).toEqual({ left: 806, top: 0 })
    expect(convertToViewportPoint).toHaveBeenCalledWith(20, 830)
  })
  it('coalesces repeated resolution requests and bounds its cache', async () => {
    const document = doc()
    const resolver = new DestinationResolver(document as unknown as PDFDocumentProxy)
    await Promise.all([resolver.resolve('one'), resolver.resolve('one')])
    expect(document.getDestination).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 101; i++) await resolver.resolve(`reference-${i}`)
    await resolver.resolve('one')
    expect(document.getDestination).toHaveBeenCalledTimes(103)
  })
})
