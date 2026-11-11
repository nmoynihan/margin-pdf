import { describe, expect, it } from 'vitest'
import { sanitizePosition, sanitizeSession, sanitizeLayout } from '../../src/shared/session'
import { emptySession, initialPosition, defaultLayout } from '../../src/shared/types'

describe('session restoration', () => {
  it('keeps appearance and placement independent and validates saved positions', () => {
    const layout = {
      controls: 'bottom',
      tabs: 'right',
      sidebar: 'right',
      documentTools: 'bottom',
      pageControls: 'bottom',
    }
    for (const skin of ['classic', 'folio', 'studio', 'terminal', 'focus'])
      expect(sanitizeSession({ ...emptySession(), skin, layout }).layout).toEqual(layout)
    expect(sanitizeSession({ version: 1, skin: 'terminal' }).layout).toEqual(defaultLayout())
    expect(sanitizeLayout({ controls: '../style', tabs: null, sidebar: 42 })).toEqual(
      defaultLayout(),
    )
  })
  it('persists supported skins and defaults older or invalid selections to Classic', () => {
    for (const skin of ['classic', 'folio', 'studio', 'terminal', 'focus'])
      expect(sanitizeSession({ ...emptySession(), skin }).skin).toBe(skin)
    expect(sanitizeSession({ version: 1 }).skin).toBe('classic')
    expect(sanitizeSession({ ...emptySession(), skin: '../injected.css' }).skin).toBe('classic')
  })
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
