import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Minus,
  Plus,
  X,
  RotateCw,
  Search,
} from 'lucide-react'
import type { PaneSnapshot, ReadingPosition } from '../../../shared/types'
import { PaneController, type PaneStatus } from '../pdf/PaneController'
import type { Destination } from '../pdf/destinations'
import type { LoadedDocument } from '../pdf/engine'
import type { PreviewRequest } from './Preview'
import { IconButton } from './Controls'

export function ReaderPane({
  pane,
  loaded,
  active,
  split,
  findOpen,
  onCloseFind,
  onFocus,
  onClose,
  onController,
  onPosition,
  onLink,
  onHover,
  onLeaveLink,
  onNavigation,
  onError,
  toolbarTarget,
  paneLabel,
}: {
  pane: PaneSnapshot
  loaded: LoadedDocument
  active: boolean
  split: boolean
  findOpen: boolean
  onFocus(): void
  onClose(): void
  onCloseFind(): void
  onController(id: string, controller: PaneController | null): void
  onPosition(id: string, position: ReadingPosition): void
  onLink(id: string, destination: Destination, modified: boolean): void
  onHover(request: PreviewRequest): void
  onLeaveLink(): void
  onNavigation(): void
  onError(message: string): void
  toolbarTarget?: HTMLElement | null
  paneLabel?: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const controller = useRef<PaneController | null>(null)
  const callbacks = useRef({
    onController,
    onPosition,
    onLink,
    onHover,
    onLeaveLink,
    onNavigation,
    onError,
  })
  callbacks.current = {
    onController,
    onPosition,
    onLink,
    onHover,
    onLeaveLink,
    onNavigation,
    onError,
  }
  const [status, setStatus] = useState<PaneStatus>({
    page: pane.position.page,
    count: loaded.pdf.numPages,
    zoom: pane.position.zoom,
    scale: 1,
    rotation: pane.position.rotation,
    back: false,
    forward: false,
    matches: { current: 0, total: 0 },
    finding: false,
  })
  const [pageInput, setPageInput] = useState(String(status.page))
  const pageDirty = useRef(false)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const view = new PaneController(
      container.current!,
      loaded,
      pane.position,
      (next, position) => {
        setStatus(next)
        callbacks.current.onPosition(pane.id, position)
      },
      (destination, modified) => callbacks.current.onLink(pane.id, destination, modified),
      (message) => callbacks.current.onError(message),
    )
    controller.current = view
    callbacks.current.onController(pane.id, view)
    const root = container.current!
    let hoverVersion = 0
    const requestPreview = (anchor: HTMLAnchorElement) => {
      const version = ++hoverVersion
      void view
        .targetFor(anchor)
        .then((target) => {
          if (version !== hoverVersion || !target) return
          if (target.url) {
            anchor.title = target.url
            return
          }
          if (target.destination) {
            anchor.setAttribute('aria-haspopup', 'dialog')
            anchor.setAttribute('aria-controls', 'link-preview')
            anchor.setAttribute('aria-keyshortcuts', 'Alt+ArrowDown')
            anchor.setAttribute(
              'aria-description',
              'Press Alt+ArrowDown or Tab to enter the link preview.',
            )
            const { left, top, right, bottom } = anchor.getBoundingClientRect()
            callbacks.current.onHover({
              sourceId: pane.id,
              sourceElement: anchor,
              destination: target.destination,
              anchor: { left, top, right, bottom },
              rotation: view.status().rotation,
            })
          }
        })
        .catch(() => {})
    }
    const enter = (event: PointerEvent | FocusEvent) => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a')
      if (
        !anchor ||
        anchor.dataset.previewReturning ||
        ('relatedTarget' in event &&
          event.relatedTarget instanceof Node &&
          anchor.contains(event.relatedTarget))
      )
        return
      requestPreview(anchor)
    }
    const leave = (event: PointerEvent | FocusEvent) => {
      const anchor = (event.target as HTMLElement).closest('a')
      if (
        anchor &&
        !(event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget))
      ) {
        hoverVersion++
        callbacks.current.onLeaveLink()
      }
    }
    let scrollFrame = 0
    const scroll = () => {
      cancelAnimationFrame(scrollFrame)
      scrollFrame = requestAnimationFrame(() => {
        // Focusing a PDF link can scroll it into view; preserve that keyboard preview.
        if (
          root.contains(document.activeElement) &&
          document.activeElement?.closest('.linkAnnotation a')
        )
          return
        callbacks.current.onNavigation()
        // Scrolling to a pointer-hovered link can precede its final pointerover event.
        const hovered = root.querySelector<HTMLAnchorElement>('.linkAnnotation a:hover')
        if (hovered) requestPreview(hovered)
      })
    }
    root.addEventListener('pointerover', enter)
    root.addEventListener('pointerout', leave)
    root.addEventListener('focusin', enter)
    root.addEventListener('focusout', leave)
    root.addEventListener('scroll', scroll, { passive: true })
    return () => {
      hoverVersion++
      cancelAnimationFrame(scrollFrame)
      callbacks.current.onController(pane.id, null)
      root.removeEventListener('pointerover', enter)
      root.removeEventListener('pointerout', leave)
      root.removeEventListener('focusin', enter)
      root.removeEventListener('focusout', leave)
      root.removeEventListener('scroll', scroll)
      view.dispose()
      controller.current = null
    }
  }, [loaded, pane.id])

  useEffect(() => {
    if (!pageDirty.current) setPageInput(loaded.labels?.[status.page - 1] ?? String(status.page))
  }, [status.page, loaded])
  useEffect(() => {
    if (active && findOpen) search.current?.focus()
    else if (!findOpen) controller.current?.closeFind()
  }, [active, findOpen])
  useEffect(() => {
    if (findOpen) controller.current?.find(query, false, false, caseSensitive)
  }, [query, caseSensitive, findOpen, loaded])
  const goToInputPage = () => {
    if (!pageDirty.current) return
    pageDirty.current = false
    const labelled = loaded.labels?.indexOf(pageInput)
    const page = labelled !== undefined && labelled >= 0 ? labelled + 1 : Number(pageInput)
    if (page !== status.page) controller.current?.goToPage(page)
    setPageInput(loaded.labels?.[status.page - 1] ?? String(status.page))
  }

  const toolbar = (
    <div className="pane-toolbar">
      <div className="pane-history">
        <IconButton
          icon={ArrowLeft}
          label="Back"
          disabled={!status.back}
          onClick={() => controller.current?.goBack()}
        />
        <IconButton
          icon={ArrowRight}
          label="Forward"
          disabled={!status.forward}
          onClick={() => controller.current?.goForward()}
        />
      </div>
      <div className="page-control">
        <input
          aria-label="Page number"
          value={pageInput}
          onChange={(event) => {
            pageDirty.current = true
            setPageInput(event.target.value)
          }}
          onBlur={goToInputPage}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              goToInputPage()
              event.currentTarget.blur()
            }
          }}
        />
        <span>/ {status.count}</span>
      </div>
      <span className="toolbar-divider" />
      <IconButton
        icon={Minus}
        label="Zoom out"
        onClick={() => controller.current?.zoomBy(1 / 1.2)}
      />
      <select
        aria-label="Zoom"
        value={['page-width', 'page-fit', 'auto'].includes(status.zoom) ? status.zoom : 'custom'}
        onChange={(event) => controller.current?.zoom(event.target.value)}
      >
        <option value="page-width">Fit width</option>
        <option value="page-fit">Fit page</option>
        <option value="auto">Automatic</option>
        <option value="custom" disabled>
          {Math.round(status.scale * 100)}%
        </option>
        {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((value) => (
          <option key={value} value={String(value)}>
            {value * 100}%
          </option>
        ))}
      </select>
      <IconButton icon={Plus} label="Zoom in" onClick={() => controller.current?.zoomBy(1.2)} />
      <IconButton
        icon={RotateCw}
        label="Rotate clockwise"
        className="rotation-button"
        onClick={() => controller.current?.rotate()}
      />
      <span className="pane-toolbar-spacer" />
      {split && (
        <>
          <span className="pane-label">{paneLabel ?? (active ? 'ACTIVE' : 'REFERENCE')}</span>
          <IconButton icon={X} label="Close pane" onClick={onClose} />
        </>
      )}
    </div>
  )

  return (
    <section
      className={`reader-pane${active ? ' active-pane' : ''}`}
      data-pane-id={pane.id}
      aria-label={`Reading pane ${pane.id}`}
      onPointerDown={onFocus}
      onFocusCapture={onFocus}
    >
      {toolbarTarget === undefined
        ? toolbar
        : active && toolbarTarget && createPortal(toolbar, toolbarTarget)}
      {findOpen && (
        <div className="find-bar">
          <Search size={15} />
          <input
            ref={search}
            aria-label="Find in paper"
            placeholder="Find in this paper…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter')
                controller.current?.find(query, true, event.shiftKey, caseSensitive)
              if (event.key === 'Escape') onCloseFind()
            }}
          />
          <button
            title="Match case"
            aria-label="Match case"
            aria-pressed={caseSensitive}
            className={caseSensitive ? 'case-toggle is-active' : 'case-toggle'}
            onClick={() => setCaseSensitive(!caseSensitive)}
          >
            Aa
          </button>
          <span className="match-count" aria-live="polite">
            {query
              ? status.finding
                ? 'Searching…'
                : `${status.matches.current} / ${status.matches.total}`
              : ''}
          </span>
          <IconButton
            icon={ChevronUp}
            label="Previous match"
            disabled={!query}
            onClick={() => controller.current?.find(query, true, true, caseSensitive)}
          />
          <IconButton
            icon={ChevronDown}
            label="Next match"
            disabled={!query}
            onClick={() => controller.current?.find(query, true, false, caseSensitive)}
          />
          <IconButton icon={X} label="Close search" onClick={onCloseFind} />
        </div>
      )}
      <div className="pane-viewport-wrap">
        <div ref={container} className="pdf-container" tabIndex={0} aria-label="PDF pages">
          <div className="pdfViewer" />
        </div>
      </div>
    </section>
  )
}
