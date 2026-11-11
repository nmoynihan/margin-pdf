import {
  emptySession,
  initialPosition,
  skinIds,
  defaultLayout,
  type WorkspaceLayout,
  type SessionSnapshot,
  type ReadingPosition,
} from './types'

const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export function sanitizeLayout(input: unknown): WorkspaceLayout {
  const defaults = defaultLayout()
  const value = (input && typeof input === 'object' ? input : {}) as Partial<WorkspaceLayout>
  return {
    controls: ['top', 'left', 'bottom'].includes(value.controls ?? '')
      ? value.controls!
      : defaults.controls,
    tabs: ['top', 'bottom', 'left', 'right'].includes(value.tabs ?? '')
      ? value.tabs!
      : defaults.tabs,
    sidebar: ['left', 'right', 'overlay'].includes(value.sidebar ?? '')
      ? value.sidebar!
      : defaults.sidebar,
    documentTools: ['top', 'bottom'].includes(value.documentTools ?? '')
      ? value.documentTools!
      : defaults.documentTools,
    pageControls: ['top', 'bottom'].includes(value.pageControls ?? '')
      ? value.pageControls!
      : defaults.pageControls,
  }
}

export function sanitizePosition(input: unknown): ReadingPosition {
  const p = (input ?? {}) as Partial<ReadingPosition>
  return {
    page: Math.max(1, Math.floor(finite(p.page, 1))),
    left: finite(p.left, 0),
    top: finite(p.top, 0),
    zoom:
      typeof p.zoom === 'string' &&
      /^(page-width|page-fit|auto|[0-9]+(\.[0-9]+)?)$/.test(p.zoom) &&
      (Number.isNaN(Number(p.zoom)) || Number(p.zoom) > 0)
        ? p.zoom
        : 'page-width',
    rotation: [0, 90, 180, 270].includes(p.rotation ?? -1) ? p.rotation! : 0,
  }
}

export function sanitizeSession(input: unknown): SessionSnapshot {
  if (!input || typeof input !== 'object' || (input as SessionSnapshot).version !== 1)
    return emptySession()
  const s = input as SessionSnapshot
  const sanitizeTabs = (input: unknown): SessionSnapshot['tabs'] =>
    (Array.isArray(input) ? (input as SessionSnapshot['tabs']) : [])
      .slice(0, 100)
      .filter((t) => t && typeof t.documentId === 'string')
      .map((t) => {
        const panes = (Array.isArray(t.panes) ? t.panes : [])
          .slice(0, 2)
          .filter((p) => p && typeof p.id === 'string')
          .map((p) => ({ id: p.id, position: sanitizePosition(p.position) }))
        if (!panes.length) panes.push({ id: 'main', position: initialPosition() })
        if (panes.length === 2 && panes[0].id === panes[1].id) panes[1].id += '-secondary'
        return {
          documentId: t.documentId,
          panes,
          activePaneId: panes.some((p) => p.id === t.activePaneId) ? t.activePaneId : panes[0].id,
          orientation:
            t.orientation === 'vertical' ? ('vertical' as const) : ('horizontal' as const),
          ratio: Math.min(0.8, Math.max(0.2, finite(t.ratio, 0.5))),
        }
      })
  const tabs = sanitizeTabs(s.tabs)
  return {
    version: 1,
    tabs: tabs.filter((t, i) => tabs.findIndex((other) => other.documentId === t.documentId) === i),
    activeDocumentId: typeof s.activeDocumentId === 'string' ? s.activeDocumentId : null,
    theme: ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system',
    skin: skinIds.includes(s.skin) ? s.skin : 'classic',
    layout: sanitizeLayout(s.layout),
    sidebar: s.sidebar === 'thumbnails' ? 'thumbnails' : s.sidebar === null ? null : 'outline',
    rememberedTabs: sanitizeTabs(s.rememberedTabs),
  }
}
