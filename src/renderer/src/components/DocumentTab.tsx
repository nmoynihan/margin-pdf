import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  PanelLeft,
  PanelLeftOpen,
  PanelRightOpen,
  ListTree,
  Grid2X2,
  Search,
  Columns2,
  Rows2,
  Printer,
  Maximize2,
  LockKeyhole,
  FileWarning,
  ArrowRight,
  RefreshCw,
  Check,
  Ellipsis,
} from 'lucide-react'
import { readerHost } from '../host'
import type { SyncTarget } from '../../../shared/reader-host'
import type {
  AppCommand,
  DocumentDescriptor,
  ReadingPosition,
  TabSnapshot,
} from '../../../shared/types'
import { initialPosition } from '../../../shared/types'
import { startDocument, type LoadedDocument } from '../pdf/engine'
import type { PaneController } from '../pdf/PaneController'
import type { Destination, ResolvedDestination } from '../pdf/destinations'
import { oppositePane } from '../model/navigation'
import { ReaderPane } from './ReaderPane'
import { Preview, type PreviewRequest } from './Preview'
import { Sidebar } from './Sidebar'
import { IconButton } from './Controls'

export function newTabSnapshot(documentId: string): TabSnapshot {
  return {
    documentId,
    panes: [{ id: 'main', position: initialPosition() }],
    activePaneId: 'main',
    orientation: 'horizontal',
    ratio: 0.5,
  }
}

export function DocumentTab({
  descriptor,
  initial,
  active,
  sidebar,
  sidebarPosition,
  onSidebar,
  onSnapshot,
  onTitle,
  onCommandHandler,
  onError,
  onClose,
  onPrint,
  printing,
  fileError,
  compact = false,
  secondaryActions,
  syncTarget,
  reloadLabel = 'Reload PDF from disk',
  toolbarTarget,
  paneToolbarTarget,
}: {
  compact?: boolean
  secondaryActions?: ReactNode
  syncTarget?: SyncTarget
  reloadLabel?: string
  toolbarTarget?: HTMLElement | null
  paneToolbarTarget?: HTMLElement | null
  descriptor: DocumentDescriptor
  initial: TabSnapshot
  active: boolean
  sidebar: 'outline' | 'thumbnails' | null
  sidebarPosition: 'left' | 'right' | 'overlay'
  onSidebar(mode: 'outline' | 'thumbnails' | null): void
  onSnapshot(snapshot: TabSnapshot): void
  onTitle(title: string): void
  onCommandHandler(id: string, handler: ((command: AppCommand) => void) | null): void
  onError(message: string): void
  onClose(): void
  onPrint(loaded: LoadedDocument): void
  printing: boolean
  fileError?: string
}) {
  const lastSidebar = useRef<'outline' | 'thumbnails'>(sidebar ?? 'outline')
  const focusSidebar = useRef(false)
  if (sidebar) lastSidebar.current = sidebar
  useEffect(() => {
    if (!focusSidebar.current) return
    focusSidebar.current = false
    const navigation = document.getElementById(`navigation-${descriptor.id}`)
    navigation?.querySelector<HTMLButtonElement>(sidebar ? '.is-active' : 'button')?.focus()
  }, [sidebar, descriptor.id])
  const [loaded, setLoaded] = useState<LoadedDocument | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [reloading, setReloading] = useState(false)
  const [updateError, setUpdateError] = useState('')
  const [updated, setUpdated] = useState(false)
  const liveResource = useRef<LoadedDocument | null>(null)
  const retiredResources = useRef<LoadedDocument[]>([])
  const requested = useRef('')
  const [password, setPassword] = useState<{
    submit(value: string): void
    incorrect: boolean
  } | null>(null)
  const [passwordInput, setPasswordInput] = useState('')
  const [snapshot, setSnapshot] = useState(initial)
  const current = useRef(initial)
  const controllers = useRef(new Map<string, PaneController>())
  const pending = useRef(new Map<string, ResolvedDestination>())
  const callbacks = useRef({ onSnapshot, onTitle, onError, onCommandHandler })
  callbacks.current = { onSnapshot, onTitle, onError, onCommandHandler }
  const [hasBeenActive, setHasBeenActive] = useState(active)
  const [activePage, setActivePage] = useState(
    initial.panes.find((p) => p.id === initial.activePaneId)?.position.page ?? 1,
  )
  const [findOpen, setFindOpen] = useState(false)
  const [preview, setPreview] = useState<PreviewRequest | null>(null)
  const previewRef = useRef(preview)
  const appliedSync = useRef(0)
  previewRef.current = preview
  const latestHover = useRef<PreviewRequest | null>(null)
  const restoringFocus = useRef(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const splitArea = useRef<HTMLDivElement>(null)
  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 })
  const effectiveOrientation =
    snapshot.orientation === 'horizontal' && areaSize.width > 0 && areaSize.width < 620
      ? 'vertical'
      : snapshot.orientation
  const extent = effectiveOrientation === 'horizontal' ? areaSize.width : areaSize.height
  const minimum = effectiveOrientation === 'horizontal' ? 280 : findOpen ? 150 : 110
  const minRatio = extent > 0 ? Math.min(0.5, Math.max(0.2, (minimum + 6) / extent)) : 0.2
  const effectiveRatio = Math.min(1 - minRatio, Math.max(minRatio, snapshot.ratio))
  useEffect(() => {
    const element = splitArea.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setAreaSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [loaded])
  const dragCleanup = useRef<(() => void) | undefined>(undefined)

  const commit = useCallback((next: TabSnapshot) => {
    current.current = next
    setSnapshot(next)
    callbacks.current.onSnapshot(next)
  }, [])
  const dismissPreview = useCallback(() => {
    clearTimeout(hoverTimer.current)
    clearTimeout(closeTimer.current)
    const source = previewRef.current?.sourceElement
    const returnFocus = document.activeElement?.closest('.link-preview')
    previewRef.current = null
    setPreview(null)
    if (returnFocus && source?.isConnected) {
      restoringFocus.current = true
      source.dataset.previewReturning = 'true'
      source.focus({ preventScroll: true })
      delete source.dataset.previewReturning
      restoringFocus.current = false
    }
  }, [])
  const hover = useCallback((request: PreviewRequest) => {
    if (restoringFocus.current) return
    latestHover.current = request
    clearTimeout(hoverTimer.current)
    clearTimeout(closeTimer.current)
    hoverTimer.current = setTimeout(() => setPreview(request), 300)
  }, [])
  const leave = useCallback(() => {
    if (latestHover.current?.sourceElement === document.activeElement) return
    clearTimeout(hoverTimer.current)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      if (
        document.activeElement?.closest('.link-preview') ||
        latestHover.current?.sourceElement === document.activeElement
      )
        return
      setPreview(null)
    }, 220)
  }, [])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const request = previewRef.current
      if (!request || document.activeElement !== request.sourceElement) return
      if ((event.altKey && event.key === 'ArrowDown') || (event.key === 'Tab' && !event.shiftKey)) {
        event.preventDefault()
        clearTimeout(closeTimer.current)
        document.querySelector<HTMLElement>('.link-preview button')?.focus()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  useEffect(() => {
    if (active) setHasBeenActive(true)
    else dismissPreview()
  }, [active, dismissPreview])
  useEffect(() => {
    if (!hasBeenActive || !active || printing) return
    const key = `${descriptor.id}:${descriptor.revision ?? descriptor.modified}:${attempt}`
    if (requested.current === key) return
    requested.current = key
    let alive = true
    let succeeded = false
    let retries = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let task: ReturnType<typeof startDocument> | undefined
    setError('')
    setUpdateError('')
    setUpdated(false)
    setReloading(Boolean(liveResource.current))
    setPassword(null)
    const load = () => {
      task = startDocument(descriptor, (submit, incorrect) => {
        if (alive) {
          setPassword({ submit, incorrect })
          setPasswordInput('')
        }
      })
      void task.promise
        .then((value) => {
          if (!alive) {
            void value.destroy()
            return
          }
          succeeded = true
          const previous = liveResource.current
          if (previous) {
            dismissPreview()
            const next = {
              ...current.current,
              panes: current.current.panes.map((pane) => ({
                ...pane,
                position: {
                  ...(controllers.current.get(pane.id)?.currentPosition() ?? pane.position),
                  page: Math.min(
                    value.pdf.numPages,
                    controllers.current.get(pane.id)?.currentPosition().page ?? pane.position.page,
                  ),
                },
              })),
            }
            for (const controller of controllers.current.values()) controller.dispose()
            controllers.current.clear()
            pending.current.clear()
            commit(next)
            setActivePage(next.panes.find((pane) => pane.id === next.activePaneId)!.position.page)
            retiredResources.current.push(previous)
          }
          liveResource.current = value
          setPassword(null)
          setReloading(false)
          setUpdated(Boolean(previous))
          setLoaded(value)
          callbacks.current.onTitle(value.title)
        })
        .catch((reason) => {
          if (!alive) return
          // A compiler can pause mid-write. Retry before asking the reader to intervene.
          if (liveResource.current && retries++ < 2 && !/budget|password/i.test(reason.message)) {
            retryTimer = setTimeout(load, 900)
            return
          }
          setPassword(null)
          setReloading(false)
          if (liveResource.current)
            setUpdateError(reason.message || 'Could not load the updated PDF.')
          else setError(reason.message || 'Could not read this PDF.')
        })
    }
    load()
    return () => {
      alive = false
      clearTimeout(retryTimer)
      if (!succeeded) {
        requested.current = ''
        void task?.cancel().catch(() => {})
      }
    }
  }, [
    descriptor.id,
    descriptor.revision,
    descriptor.modified,
    attempt,
    hasBeenActive,
    active,
    printing,
    commit,
    dismissPreview,
  ])
  useEffect(() => {
    // Child views have detached from the old PDF before its shared worker is destroyed.
    for (const resource of retiredResources.current.splice(0))
      void resource.destroy().catch(() => {})
  }, [loaded])
  useEffect(() => {
    if (
      !active ||
      !loaded ||
      reloading ||
      loaded.descriptor.revision !== descriptor.revision ||
      !syncTarget ||
      appliedSync.current === syncTarget.requestId
    )
      return
    const controller = controllers.current.get(current.current.activePaneId)
    if (!controller) return
    appliedSync.current = syncTarget.requestId
    dismissPreview()
    void controller.syncTo(syncTarget).catch((reason) => callbacks.current.onError(reason.message))
  }, [syncTarget, loaded, reloading, active, descriptor.revision, dismissPreview])
  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.dispose()
      controllers.current.clear()
      if (liveResource.current) void liveResource.current.destroy().catch(() => {})
      for (const resource of retiredResources.current.splice(0))
        void resource.destroy().catch(() => {})
    },
    [],
  )
  useEffect(
    () => () => {
      clearTimeout(hoverTimer.current)
      clearTimeout(closeTimer.current)
      dragCleanup.current?.()
    },
    [],
  )

  const onPosition = useCallback((id: string, position: ReadingPosition) => {
    const next = {
      ...current.current,
      panes: current.current.panes.map((p) => (p.id === id ? { ...p, position } : p)),
    }
    current.current = next
    callbacks.current.onSnapshot(next)
    if (id === next.activePaneId) setActivePage(position.page)
  }, [])
  const onController = useCallback((id: string, controller: PaneController | null) => {
    if (!controller) {
      controllers.current.delete(id)
      return
    }
    controllers.current.set(id, controller)
    const destination = pending.current.get(id)
    if (destination) {
      pending.current.delete(id)
      void controller.navigate(destination)
    }
  }, [])
  const focus = (id: string) => {
    if (current.current.activePaneId === id) return
    commit({ ...current.current, activePaneId: id })
    setActivePage(controllers.current.get(id)?.status().page ?? 1)
  }
  const closePane = (id: string) => {
    dismissPreview()
    const panes = current.current.panes.filter((p) => p.id !== id)
    if (!panes.length) return
    commit({ ...current.current, panes, activePaneId: panes[0].id })
    setActivePage(panes[0].position.page)
  }
  const splitFrom = (sourceId: string, destination?: ResolvedDestination) => {
    const source = controllers.current.get(sourceId)
    if (source) onPosition(sourceId, source.currentPosition())
    const next = oppositePane(current.current.panes, sourceId, crypto.randomUUID())
    if (destination) {
      const target = controllers.current.get(next.targetId)
      if (target) void target.navigate(destination)
      else pending.current.set(next.targetId, destination)
    }
    commit({ ...current.current, panes: next.panes })
  }
  const navigate = (
    sourceId: string,
    destination: Destination | ResolvedDestination,
    split: boolean,
  ) => {
    dismissPreview()
    if (!loaded) return
    void (async () => {
      const resolved =
        'pageNumber' in Object(destination)
          ? (destination as ResolvedDestination)
          : await loaded.resolver.resolve(destination as Destination)
      if (split) {
        splitFrom(sourceId, resolved)
        splitArea.current
          ?.querySelector<HTMLElement>(`[data-pane-id="${sourceId}"] .pdf-container`)
          ?.focus()
      } else {
        focus(sourceId)
        await controllers.current.get(sourceId)?.navigate(resolved)
        splitArea.current
          ?.querySelector<HTMLElement>(`[data-pane-id="${sourceId}"] .pdf-container`)
          ?.focus()
      }
    })().catch((reason) => callbacks.current.onError(reason.message))
  }

  const print = () => {
    if (!loaded || printing) return
    dismissPreview()
    onPrint(loaded)
  }

  useEffect(() => {
    const handler = (command: AppCommand) => {
      const controller = controllers.current.get(current.current.activePaneId)
      switch (command) {
        case 'find':
          setFindOpen((value) => !value)
          break
        case 'print':
          void print()
          break
        case 'zoom-in':
          dismissPreview()
          controller?.zoomBy(1.2)
          break
        case 'zoom-out':
          dismissPreview()
          controller?.zoomBy(1 / 1.2)
          break
        case 'fit-width':
          dismissPreview()
          controller?.zoom('page-width')
          break
        case 'rotate':
          dismissPreview()
          controller?.rotate()
          break
        case 'back':
          dismissPreview()
          controller?.goBack()
          break
        case 'forward':
          dismissPreview()
          controller?.goForward()
          break
        case 'split':
          dismissPreview()
          if (current.current.panes.length === 2)
            closePane(current.current.panes.find((p) => p.id !== current.current.activePaneId)!.id)
          else splitFrom(current.current.activePaneId)
          break
      }
    }
    callbacks.current.onCommandHandler(descriptor.id, handler)
    return () => callbacks.current.onCommandHandler(descriptor.id, null)
  })

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    dismissPreview()
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    document.body.classList.add('resizing')
    const move = (pointer: PointerEvent) => {
      const box = splitArea.current!.getBoundingClientRect()
      const ratio =
        effectiveOrientation === 'horizontal'
          ? (pointer.clientX - box.left) / box.width
          : (pointer.clientY - box.top) / box.height
      commit({ ...current.current, ratio: Math.min(1 - minRatio, Math.max(minRatio, ratio)) })
    }
    const finish = () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', finish)
      element.removeEventListener('pointercancel', finish)
      document.body.classList.remove('resizing')
      dragCleanup.current = undefined
    }
    dragCleanup.current?.()
    dragCleanup.current = finish
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', finish)
    element.addEventListener('pointercancel', finish)
  }

  const toolbar = (
    <div className="document-toolbar">
      <IconButton
        icon={PanelLeft}
        label="Toggle sidebar"
        active={sidebar !== null}
        onClick={() => {
          dismissPreview()
          onSidebar(sidebar ? null : lastSidebar.current)
        }}
        aria-expanded={sidebar !== null}
        aria-controls={`navigation-${descriptor.id}`}
      />
      <span className="toolbar-divider" />
      <div className="document-heading">
        <span className="document-title" title={loaded?.title ?? descriptor.name}>
          {loaded?.title ?? descriptor.name}
        </span>
        <span className="document-subtitle">
          {loaded ? `${loaded.pdf.numPages} pages` : 'Opening paper'}
          <span>·</span>
          {descriptor.location}
        </span>
      </div>
      <div className="document-actions">
        <IconButton
          icon={RefreshCw}
          label={reloadLabel}
          disabled={printing || reloading}
          onClick={() => setAttempt((value) => value + 1)}
        />
        <IconButton
          icon={Search}
          label="Find in paper"
          active={findOpen}
          disabled={!loaded}
          onClick={() => setFindOpen(!findOpen)}
        />
        <span className="toolbar-divider" />
        <IconButton
          icon={Columns2}
          label="Toggle split view"
          active={snapshot.panes.length === 2}
          disabled={!loaded}
          onClick={() =>
            snapshot.panes.length === 2
              ? closePane(snapshot.panes.find((p) => p.id !== snapshot.activePaneId)!.id)
              : splitFrom(snapshot.activePaneId)
          }
        />
        {snapshot.panes.length === 2 && (
          <IconButton
            icon={snapshot.orientation === 'horizontal' ? Rows2 : Columns2}
            label={
              snapshot.orientation === 'horizontal'
                ? 'Stack panes vertically'
                : 'Arrange panes side by side'
            }
            onClick={() => {
              dismissPreview()
              commit({
                ...current.current,
                orientation: snapshot.orientation === 'horizontal' ? 'vertical' : 'horizontal',
              })
            }}
          />
        )}
        {compact ? (
          <details
            className="reader-overflow"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.currentTarget.open = false
                event.currentTarget.querySelector('summary')?.focus()
              }
            }}
          >
            <summary aria-label="More reader actions" title="More reader actions">
              <Ellipsis size={18} />
            </summary>
            <div className="reader-overflow-content">
              {secondaryActions}
              <button
                className="overflow-reload"
                disabled={printing || reloading}
                onClick={() => setAttempt((value) => value + 1)}
              >
                {reloadLabel}
              </button>
              {readerHost().toggleFullscreen && (
                <button onClick={() => void readerHost().toggleFullscreen?.()}>
                  Toggle fullscreen
                </button>
              )}
              {readerHost().toggleFullscreen && (
                <button disabled={!loaded || printing} onClick={() => void print()}>
                  Print paper
                </button>
              )}
            </div>
          </details>
        ) : (
          <>
            {readerHost().toggleFullscreen && (
              <IconButton
                icon={Maximize2}
                label="Toggle fullscreen"
                onClick={() => void readerHost().toggleFullscreen?.()}
              />
            )}
            <IconButton
              icon={Printer}
              label="Print paper"
              disabled={!loaded || printing}
              onClick={() => void print()}
            />
          </>
        )}
      </div>
    </div>
  )

  return (
    <div
      className={`document-tab${compact ? ' compact-document' : ''}`}
      hidden={!active}
      data-loaded-revision={loaded?.descriptor.revision}
    >
      {toolbarTarget === undefined
        ? toolbar
        : toolbarTarget && createPortal(toolbar, toolbarTarget)}
      {loaded && (fileError || updateError || reloading || updated || password) && (
        <div
          className={`file-update-banner${fileError || updateError ? ' has-warning' : ''}`}
          role="status"
        >
          {reloading ? <RefreshCw size={13} className="is-spinning" /> : <Check size={13} />}
          <span>
            {fileError ||
              (updateError
                ? `Keeping the current PDF. ${updateError}`
                : password
                  ? 'The updated PDF needs a password.'
                  : reloading
                    ? 'Updating from disk…'
                    : 'Updated from disk. Your place is saved.')}
          </span>
          {password && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                password.submit(passwordInput)
                setPasswordInput('')
                setPassword(null)
              }}
            >
              <input
                type="password"
                aria-label="Updated PDF password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
              />
              <button type="submit">Unlock updated PDF</button>
            </form>
          )}
          {(fileError || updateError) && (
            <button
              disabled={printing || reloading}
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry
            </button>
          )}
        </div>
      )}
      {!loaded ? (
        <div className="document-state">
          {error ? (
            <>
              <FileWarning size={38} strokeWidth={1.2} />
              <h2>We couldn’t open this paper</h2>
              <p>{error}</p>
              <div>
                <button className="primary-button" onClick={() => setAttempt(attempt + 1)}>
                  Try again
                </button>
                <button className="text-button" onClick={onClose}>
                  Close tab
                </button>
              </div>
            </>
          ) : password ? (
            <form
              className="password-form"
              onSubmit={(event) => {
                event.preventDefault()
                const submit = password.submit
                setPassword(null)
                submit(passwordInput)
                setPasswordInput('')
              }}
            >
              <LockKeyhole size={32} strokeWidth={1.3} />
              <h2>This paper is password protected</h2>
              <p>
                {password.incorrect
                  ? 'That password didn’t work. Please try again.'
                  : 'Enter its password to start reading.'}
              </p>
              <input
                autoFocus
                type="password"
                aria-label="PDF password"
                placeholder="Password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
              />
              <button className="primary-button" type="submit">
                Unlock paper <ArrowRight size={16} />
              </button>
              <button type="button" className="text-button" onClick={onClose}>
                Cancel
              </button>
            </form>
          ) : (
            <>
              <span className="spinner large" />
              <p>Opening your paper…</p>
            </>
          )}
        </div>
      ) : (
        <div className="reading-workspace">
          {sidebar ? (
            <Sidebar
              loaded={loaded}
              mode={sidebar}
              page={activePage}
              sourceId={snapshot.activePaneId}
              rotation={controllers.current.get(snapshot.activePaneId)?.status().rotation ?? 0}
              onMode={onSidebar}
              onCollapse={() => {
                dismissPreview()
                focusSidebar.current = true
                onSidebar(null)
              }}
              position={sidebarPosition}
              onNavigate={(destination, split) =>
                navigate(current.current.activePaneId, destination, split)
              }
              onHover={hover}
              onLeave={leave}
            />
          ) : (
            <aside
              className="sidebar-collapsed"
              id={`navigation-${descriptor.id}`}
              aria-label="Collapsed document sidebar"
            >
              <IconButton
                icon={sidebarPosition === 'right' ? PanelRightOpen : PanelLeftOpen}
                label="Show sidebar"
                aria-expanded={false}
                onClick={() => {
                  focusSidebar.current = true
                  onSidebar(lastSidebar.current)
                }}
              />
              <IconButton
                icon={ListTree}
                label="Show document outline"
                onClick={() => {
                  focusSidebar.current = true
                  onSidebar('outline')
                }}
              />
              <IconButton
                icon={Grid2X2}
                label="Show page thumbnails"
                onClick={() => {
                  focusSidebar.current = true
                  onSidebar('thumbnails')
                }}
              />
            </aside>
          )}
          <div
            ref={splitArea}
            className={`split-area ${effectiveOrientation}`}
            style={{ '--split-ratio': effectiveRatio } as React.CSSProperties}
          >
            {hasBeenActive &&
              snapshot.panes.map((pane, index) => (
                <div
                  key={pane.id}
                  className={`pane-slot ${index === 0 ? 'first-pane-slot' : 'second-pane-slot'}`}
                >
                  <ReaderPane
                    pane={pane}
                    loaded={loaded}
                    active={pane.id === snapshot.activePaneId}
                    split={snapshot.panes.length === 2}
                    toolbarTarget={paneToolbarTarget}
                    paneLabel={paneToolbarTarget !== undefined ? `Pane ${index + 1}` : undefined}
                    findOpen={findOpen}
                    onCloseFind={() => setFindOpen(false)}
                    onFocus={() => focus(pane.id)}
                    onClose={() => closePane(pane.id)}
                    onController={onController}
                    onPosition={onPosition}
                    onLink={navigate}
                    onHover={hover}
                    onLeaveLink={leave}
                    onNavigation={dismissPreview}
                    onError={onError}
                  />
                </div>
              ))}
            {snapshot.panes.length === 2 && (
              <div
                className="split-divider"
                role="separator"
                tabIndex={0}
                aria-label="Resize panes"
                title="Drag to resize panes. Double-click to reset."
                aria-orientation={effectiveOrientation === 'horizontal' ? 'vertical' : 'horizontal'}
                aria-valuenow={Math.round(effectiveRatio * 100)}
                aria-valuemin={Math.ceil(minRatio * 100)}
                aria-valuemax={Math.floor((1 - minRatio) * 100)}
                onPointerDown={startDrag}
                onDoubleClick={() => commit({ ...current.current, ratio: 0.5 })}
                onKeyDown={(event) => {
                  if (
                    ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)
                  ) {
                    event.preventDefault()
                    const delta = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -0.05 : 0.05
                    commit({
                      ...current.current,
                      ratio:
                        event.key === 'Home'
                          ? 0.5
                          : Math.min(1 - minRatio, Math.max(minRatio, effectiveRatio + delta)),
                    })
                  }
                }}
              >
                <span />
              </div>
            )}
          </div>
        </div>
      )}
      {loaded && preview && active && (
        <Preview
          request={preview}
          loaded={loaded}
          onEnter={() => {
            clearTimeout(closeTimer.current)
            clearTimeout(hoverTimer.current)
          }}
          onLeave={leave}
          onClose={dismissPreview}
          onNavigate={(destination, split) => navigate(preview.sourceId, destination, split)}
        />
      )}
    </div>
  )
}
