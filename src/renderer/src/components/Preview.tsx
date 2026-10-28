import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, Columns2, X, Link as LinkIcon } from 'lucide-react'
import { AnnotationMode } from 'pdfjs-dist'
import { EventBus, PDFPageView } from 'pdfjs-dist/web/pdf_viewer.mjs'
import type { LoadedDocument } from '../pdf/engine'
import type { Destination, ResolvedDestination } from '../pdf/destinations'
import { previewPoint } from '../pdf/destinations'
import { placePreview } from '../model/navigation'
import { IconButton } from './Controls'

export interface PreviewRequest {
  sourceId: string
  destination: Destination
  anchor: { left: number; top: number; right: number; bottom: number }
  rotation: number
}

export function Preview({
  request,
  loaded,
  onEnter,
  onLeave,
  onClose,
  onNavigate,
}: {
  request: PreviewRequest
  loaded: LoadedDocument
  onEnter(): void
  onLeave(): void
  onClose(): void
  onNavigate(destination: ResolvedDestination, split: boolean): void
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [resolved, setResolved] = useState<ResolvedDestination | null>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [bounds, setBounds] = useState(() =>
    placePreview(request.anchor, { width: innerWidth, height: innerHeight }),
  )

  useEffect(() => {
    const resize = () =>
      setBounds(placePreview(request.anchor, { width: innerWidth, height: innerHeight }))
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('resize', resize)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', key, true)
    }
  }, [request, onClose])

  useEffect(() => {
    let stopped = false
    let pageView: PDFPageView | undefined
    const mount = host.current!
    setReady(false)
    setError('')
    setResolved(null)
    void (async () => {
      const destination = await loaded.resolver.resolve(request.destination)
      const page = await loaded.pdf.getPage(destination.pageNumber)
      if (stopped) return
      setResolved(destination)
      pageView = new PDFPageView({
        container: mount,
        eventBus: new EventBus(),
        id: destination.pageNumber,
        scale: 1,
        defaultViewport: page.getViewport({ scale: 4 / 3 }),
        textLayerMode: 1,
        annotationMode: AnnotationMode.DISABLE,
        enableDetailCanvas: false,
        enableAutoLinking: false,
        maxCanvasPixels: 8_388_608,
      })
      pageView.setPdfPage(page)
      pageView.update({ rotation: request.rotation })
      await pageView.draw()
      if (stopped) return
      const point = previewPoint(destination, page, pageView.viewport)
      viewport.current!.scrollTo(point.left, point.top)
      setReady(true)
    })().catch((reason) => {
      if (!stopped) setError(reason.message || 'Preview unavailable')
    })
    return () => {
      stopped = true
      // Reset cancels this view's rendering without cleaning up the shared PDF page.
      pageView?.reset()
      mount.replaceChildren()
    }
  }, [request, loaded])

  return createPortal(
    <aside
      className="link-preview"
      role="dialog"
      aria-label="Link preview"
      style={bounds}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className="preview-heading">
        <span>
          <LinkIcon size={14} /> LINK PREVIEW
        </span>
        <span className="preview-page">
          {resolved
            ? `Page ${loaded.labels?.[resolved.pageNumber - 1] ?? resolved.pageNumber}`
            : ''}
        </span>
        <IconButton icon={X} label="Close preview" onClick={onClose} />
      </div>
      <div ref={viewport} className="preview-viewport" onWheel={(event) => event.stopPropagation()}>
        <div ref={host} className="pdfViewer preview-page-host" />
        {!ready && !error && (
          <div className="preview-message">
            <span className="spinner" /> Preparing preview…
          </div>
        )}
        {error && <div className="preview-message">{error}</div>}
      </div>
      <div className="preview-footer">
        <button
          disabled={!resolved || !!error}
          onClick={() => resolved && onNavigate(resolved, false)}
        >
          Open here <ArrowUpRight size={14} />
        </button>
        <button
          className="accent-text"
          disabled={!resolved || !!error}
          onClick={() => resolved && onNavigate(resolved, true)}
        >
          Open in other pane <Columns2 size={14} />
        </button>
      </div>
    </aside>,
    document.body,
  )
}
