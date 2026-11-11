import { describe, expect, it } from 'vitest'
import {
  MAX_PAGE_PIXELS,
  MAX_CANVAS_DIMENSION,
  PRINT_SCALE,
  printPageSize,
  printPageTiles,
  TaskGate,
} from '../../src/shared/limits'

describe('resource budgets', () => {
  it('rejects oversized, non-finite and degenerate page boxes before allocation', () => {
    for (const [width, height] of [
      [1e9, 1e9],
      [0, 842],
      [-1, 842],
      [NaN, 842],
      [Infinity, 1],
      [1, 100_000],
    ])
      expect(() => printPageSize(width, height)).toThrow('invalid print dimensions')
    const a4 = printPageSize(595, 842)
    expect(a4.width).toBe(1240)
    expect(a4.height).toBe(1755)
    expect(a4.pixels * 120 * 4).toBeGreaterThan(256 * 1024 * 1024)
  })

  it('covers large sheets with bounded tiles without changing print resolution', () => {
    for (const [width, height] of [
      [595, 842],
      [2384, 3370],
      [14400, 14400],
      [14400, 72],
    ]) {
      const size = printPageSize(width, height)
      const tiles = [...printPageTiles(width, height)]
      expect(size.width).toBe(Math.ceil(width * PRINT_SCALE))
      expect(size.height).toBe(Math.ceil(height * PRINT_SCALE))
      expect(tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0)).toBe(size.pixels)
      for (const tile of tiles) {
        expect(tile.width * tile.height).toBeLessThanOrEqual(MAX_PAGE_PIXELS)
        expect(tile.width).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
        expect(tile.height).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION)
        expect(tile.x + tile.width).toBeLessThanOrEqual(size.width)
        expect(tile.y + tile.height).toBeLessThanOrEqual(size.height)
      }
      for (const y of new Set(tiles.map((tile) => tile.y))) {
        let nextX = 0
        for (const tile of tiles.filter((tile) => tile.y === y)) {
          expect(tile.x).toBe(nextX)
          nextX += tile.width
        }
        expect(nextX).toBe(size.width)
      }
    }
  })

  it('limits concurrency and cancels queued work without consuming a slot', async () => {
    const gate = new TaskGate(2)
    const first = await gate.acquire()
    const second = await gate.acquire()
    const abort = new AbortController()
    const cancelled = gate.acquire(abort.signal)
    const rejection = expect(cancelled).rejects.toThrow()
    abort.abort()
    await rejection
    let entered = false
    const third = gate.acquire().then((release) => {
      entered = true
      return release
    })
    await Promise.resolve()
    expect(entered).toBe(false)
    first()
    const release = await third
    expect(entered).toBe(true)
    first() // A repeated release must not create an extra slot.
    release()
    second()
  })
})
