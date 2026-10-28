import { describe, expect, it } from 'vitest'
import {
  NavigationHistory,
  oppositePane,
  placePreview,
} from '../../src/renderer/src/model/navigation'
import { initialPosition } from '../../src/shared/types'

describe('independent navigation', () => {
  it('clones a source position into a new pane without changing the source', () => {
    const panes = [{ id: 'source', position: { ...initialPosition(), page: 8, rotation: 90 } }]
    const next = oppositePane(panes, 'source', 'reference')
    expect(next.targetId).toBe('reference')
    expect(panes).toHaveLength(1)
    expect(next.panes[1].position).toEqual(panes[0].position)
    expect(next.panes[1].position).not.toBe(panes[0].position)
  })
  it('reuses the opposite pane in both directions', () => {
    const panes = [
      { id: 'a', position: initialPosition() },
      { id: 'b', position: initialPosition() },
    ]
    expect(oppositePane(panes, 'a', 'unused').targetId).toBe('b')
    expect(oppositePane(panes, 'b', 'unused').targetId).toBe('a')
  })
  it('keeps back and forward stacks isolated and clears forward after a new jump', () => {
    const a = new NavigationHistory(),
      b = new NavigationHistory()
    const first = initialPosition(),
      second = { ...first, page: 4 },
      third = { ...first, page: 7 }
    a.checkpoint(first)
    expect(a.back(second)).toEqual(first)
    expect(a.forward(first)).toEqual(second)
    a.back(second)
    a.checkpoint(third)
    expect(a.canGoForward).toBe(false)
    expect(b.canGoBack).toBe(false)
  })
  it('keeps a preview inside the viewport near all edges', () => {
    const bounds = placePreview(
      { left: 790, right: 810, top: 570, bottom: 590 },
      { width: 820, height: 610 },
    )
    expect(bounds.left).toBeGreaterThanOrEqual(12)
    expect(bounds.top).toBeGreaterThanOrEqual(12)
    expect(bounds.left + bounds.width).toBeLessThanOrEqual(808)
    expect(bounds.top + bounds.height).toBeLessThanOrEqual(598)
  })
})
