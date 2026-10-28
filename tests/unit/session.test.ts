import { describe, expect, it } from 'vitest'
import { sanitizePosition, sanitizeSession } from '../../src/shared/session'
import { emptySession, initialPosition } from '../../src/shared/types'

describe('session restoration', () => {
  it('restores independent panes, orientation, and closed-document positions', () => {
    const tab = {
      documentId: 'paper',
      panes: [
        { id: 'a', position: { ...initialPosition(), page: 3, top: 615, zoom: '1.5' } },
        { id: 'b', position: { ...initialPosition(), page: 20, rotation: 90 } },
      ],
      activePaneId: 'b',
      orientation: 'vertical',
      ratio: 0.6,
    }
    expect(
      sanitizeSession({ ...emptySession(), tabs: [tab], rememberedTabs: [tab] }),
    ).toMatchObject({ tabs: [tab], rememberedTabs: [tab] })
  })
  it('recovers from malformed or incompatible state', () => {
    expect(sanitizeSession({ version: 999 })).toEqual(emptySession())
    const sanitized = sanitizeSession({
      version: 1,
      tabs: [{ documentId: 'a', panes: [], ratio: Infinity, activePaneId: 'missing' }],
      theme: 'garbage',
    })
    expect(sanitized.tabs[0].panes).toHaveLength(1)
    expect(sanitized.tabs[0].ratio).toBe(0.5)
    expect(sanitized.theme).toBe('system')
    expect(sanitizePosition({ page: -7, zoom: 'javascript:bad', top: NaN, rotation: 12 })).toEqual(
      initialPosition(),
    )
  })
})
