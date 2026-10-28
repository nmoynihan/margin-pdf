import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PanelLeft,
  Search,
  Columns2,
  Rows2,
  Printer,
  Maximize2,
  LockKeyhole,
  FileWarning,
  ArrowRight,
} from 'lucide-react'
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
import { preparePrint } from '../pdf/printing'
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
  onSidebar,
  onSnapshot,
  onTitle,
  onCommandHandler,
  onError,
  onClose,
}: {
  descriptor: DocumentDescriptor
  initial: TabSnapshot
  active: boolean
  sidebar: 'outline' | 'thumbnails' | null
  onSidebar(mode: 'outline' | 'thumbnails' | null): void
  onSnapshot(snapshot: TabSnapshot): void
  onTitle(title: string): void
  onCommandHandler(id: string, handler: ((command: AppCommand) => void) | null): void
  onError(message: string): void
  onClose(): void
}) {
  const [loaded, setLoaded] = useState<LoadedDocument | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
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
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [printProgress, setPrintProgress] = useState<{
    done: number
    total: number
    dialog: boolean
  } | null>(null)
  const printJob = useRef<AbortController | null>(null)
  const splitArea = useRef<HTMLDivElement>(null)
  const dragCleanup = useRef<(() => void) | undefined>(undefined)

  const commit = useCallback((next: TabSnapshot) => {
    current.current = next
    setSnapshot(next)
    callbacks.current.onSnapshot(next)
  }, [])
  const dismissPreview = useCallback(() => {
    clearTimeout(hoverTimer.current)
    clearTimeout(closeTimer.current)
    setPreview(null)
  }, [])
  const hover = useCallback((request: PreviewRequest) => {
    clearTimeout(hoverTimer.current)
    clearTimeout(closeTimer.current)
    hoverTimer.current = setTimeout(() => setPreview(request), 300)
  }, [])
  const leave = useCallback(() => {
    clearTimeout(hoverTimer.current)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setPreview(null), 220)
  }, [])

  useEffect(() => {
    if (active) setHasBeenActive(true)
    else dismissPreview()
  }, [active, dismissPreview])
  useEffect(() => {
    let alive = true
    let resource: LoadedDocument | undefined
    setError('')
    setLoaded(null)
    setPassword(null)
    const task = startDocument(descriptor, (submit, incorrect) => {
      if (alive) {
        setPassword({ submit, incorrect })
        setPasswordInput('')
      }
    })
    void task.promise
      .then((value) => {
        resource = value
        if (!alive) {
          void value.destroy()
          return
        }
        setPassword(null)
        setLoaded(value)
        callbacks.current.onTitle(value.title)
      })
      .catch((reason) => {
        if (alive) {
          setPassword(null)
          setError(reason.message || 'Could not read this PDF.')
        }
      })
    return () => {
      alive = false
      // Dispose views before their shared worker, including when React unmounts a tab.
      for (const controller of controllers.current.values()) controller.dispose()
      controllers.current.clear()
      if (resource) void resource.destroy().catch(() => {})
      else void task.cancel().catch(() => {})
    }
  }, [descriptor.id, attempt])
  useEffect(
    () => () => {
      clearTimeout(hoverTimer.current)
      clearTimeout(closeTimer.current)
      printJob.current?.abort()
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
      if (split) splitFrom(sourceId, resolved)
      else {
        focus(sourceId)
        await controllers.current.get(sourceId)?.navigate(resolved)
      }
    })().catch((reason) => callbacks.current.onError(reason.message))
  }

  const print = async () => {
    if (!loaded || printJob.current) return
    dismissPreview()
    const job = new AbortController()
    printJob.current = job
    setPrintProgress({ done: 0, total: loaded.pdf.numPages, dialog: false })
    let cleanup: (() => void) | undefined
    try {
      cleanup = await preparePrint(loaded, job.signal, (done, total) =>
        setPrintProgress({ done, total, dialog: false }),
      )
      setPrintProgress({ done: loaded.pdf.numPages, total: loaded.pdf.numPages, dialog: true })
      const result = await window.desktop.print()
      if (!result.success && result.reason && !/cancel/i.test(result.reason))
        callbacks.current.onError(result.reason)
    } catch (reason) {
      if (!job.signal.aborted) callbacks.current.onError((reason as Error).message)
    } finally {
      cleanup?.()
      printJob.current = null
      setPrintProgress(null)
    }
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
        current.current.orientation === 'horizontal'
          ? (pointer.clientX - box.left) / box.width
          : (pointer.clientY - box.top) / box.height
      commit({ ...current.current, ratio: Math.min(0.8, Math.max(0.2, ratio)) })
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

  return (
    <div className="document-tab" hidden={!active}>
      <div className="document-toolbar">
        <IconButton
          icon={PanelLeft}
          label="Toggle sidebar"
          active={sidebar !== null}
          onClick={() => onSidebar(sidebar ? null : 'outline')}
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
          <IconButton
            icon={Maximize2}
            label="Toggle fullscreen"
            onClick={() => void window.desktop.toggleFullscreen()}
          />
          <IconButton
            icon={Printer}
            label="Print paper"
            disabled={!loaded}
            onClick={() => void print()}
          />
        </div>
      </div>
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
          {sidebar && (
            <Sidebar
              loaded={loaded}
              mode={sidebar}
              page={activePage}
              sourceId={snapshot.activePaneId}
              rotation={controllers.current.get(snapshot.activePaneId)?.status().rotation ?? 0}
              onMode={onSidebar}
              onNavigate={(destination, split) =>
                navigate(current.current.activePaneId, destination, split)
              }
              onHover={hover}
              onLeave={leave}
            />
          )}
          <div
            ref={splitArea}
            className={`split-area ${snapshot.orientation}`}
            style={{ '--split-ratio': snapshot.ratio } as React.CSSProperties}
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
                aria-orientation={snapshot.orientation === 'horizontal' ? 'vertical' : 'horizontal'}
                aria-valuenow={Math.round(snapshot.ratio * 100)}
                aria-valuemin={20}
                aria-valuemax={80}
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
                          : Math.min(0.8, Math.max(0.2, current.current.ratio + delta)),
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
      {printProgress && (
        <div className="modal-backdrop">
          <div
            className="print-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Prepare printing"
          >
            <Printer size={28} strokeWidth={1.4} />
            <h2>{printProgress.dialog ? 'Ready to print' : 'Preparing your paper'}</h2>
            <p>
              {printProgress.dialog
                ? 'Choose your printer in the print dialog.'
                : `Rendering page ${printProgress.done} of ${printProgress.total}…`}
            </p>
            <progress value={printProgress.done} max={printProgress.total} />
            {!printProgress.dialog && (
              <button className="text-button" onClick={() => printJob.current?.abort()}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
