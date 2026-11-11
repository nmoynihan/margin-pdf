import { readerHost } from '../host'
import { useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  ExternalLink,
  ListTree,
  Grid2X2,
  PanelLeftClose,
  PanelRightClose,
} from 'lucide-react'
import type { LoadedDocument } from '../pdf/engine'
import type { Destination } from '../pdf/destinations'
import type { PreviewRequest } from './Preview'
import { MAX_PAGE_PIXELS, MAX_CANVAS_DIMENSION } from '../../../shared/limits'
import { IconButton } from './Controls'

function Thumbnail({
  loaded,
  pageNumber,
  current,
  onClick,
}: {
  loaded: LoadedDocument
  pageNumber: number
  current: boolean
  onClick(): void
}) {
  const button = useRef<HTMLButtonElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '250px' },
    )
    observer.observe(button.current!)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let stopped = false
    let task:
      ReturnType<Awaited<ReturnType<LoadedDocument['pdf']['getPage']>>['render']> | undefined
    void loaded.pdf
      .getPage(pageNumber)
      .then(async (page) => {
        if (stopped || !canvas.current) return
        const points = page.getViewport({ scale: 1 })
        const scale = Math.min(
          144 / points.width,
          Math.sqrt(MAX_PAGE_PIXELS / (points.width * points.height)) / devicePixelRatio,
          MAX_CANVAS_DIMENSION / Math.max(points.width, points.height) / devicePixelRatio,
        )
        const viewport = page.getViewport({ scale })
        const element = canvas.current
        element.width = Math.ceil(viewport.width * devicePixelRatio)
        element.height = Math.ceil(viewport.height * devicePixelRatio)
        task = page.render({
          canvas: element,
          viewport,
          transform: [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0],
        })
        await task.promise
      })
      .catch(() => {})
    return () => {
      stopped = true
      task?.cancel()
    }
  }, [visible, loaded, pageNumber])
  return (
    <button
      ref={button}
      className={`thumbnail${current ? ' current-thumbnail' : ''}`}
      onClick={onClick}
      aria-label={`Go to page ${pageNumber}`}
      aria-current={current ? 'page' : undefined}
    >
      <div className="thumbnail-paper">
        <canvas ref={canvas} />
      </div>
      <span>{loaded.labels?.[pageNumber - 1] ?? pageNumber}</span>
    </button>
  )
}

function OutlineItems({
  items,
  level = 0,
  onNavigate,
  onHover,
  onLeave,
}: {
  items: NonNullable<LoadedDocument['outline']>
  level?: number
  onNavigate(destination: Destination, split: boolean): void
  onHover(destination: Destination, anchor: HTMLElement): void
  onLeave(): void
}) {
  return (
    <ul className="outline-list" style={{ '--outline-level': level } as React.CSSProperties}>
      {items.map((item, index) => (
        <li key={`${index}-${item.title}`}>
          {item.items.length ? (
            <details open={level === 0}>
              <summary>
                <ChevronRight size={13} />
                <button
                  onClick={(event) => {
                    event.preventDefault()
                    if (item.dest) onNavigate(item.dest, event.ctrlKey || event.metaKey)
                  }}
                  onPointerEnter={(event) => item.dest && onHover(item.dest, event.currentTarget)}
                  onPointerLeave={onLeave}
                  onFocus={(event) => item.dest && onHover(item.dest, event.currentTarget)}
                  onBlur={onLeave}
                >
                  {item.title}
                </button>
              </summary>
              <OutlineItems
                items={item.items}
                level={level + 1}
                onNavigate={onNavigate}
                onHover={onHover}
                onLeave={onLeave}
              />
            </details>
          ) : (
            <button
              className="outline-entry"
              onClick={(event) => {
                if (item.dest) onNavigate(item.dest, event.ctrlKey || event.metaKey)
                else if (item.url) void readerHost().openExternal(item.url)
              }}
              onPointerEnter={(event) => item.dest && onHover(item.dest, event.currentTarget)}
              onPointerLeave={onLeave}
              onFocus={(event) => item.dest && onHover(item.dest, event.currentTarget)}
              onBlur={onLeave}
            >
              {item.title}
              {item.url && <ExternalLink size={12} />}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export function Sidebar({
  loaded,
  mode,
  page,
  sourceId,
  rotation,
  onMode,
  onCollapse,
  position,
  onNavigate,
  onHover,
  onLeave,
}: {
  loaded: LoadedDocument
  mode: 'outline' | 'thumbnails'
  page: number
  sourceId: string
  rotation: number
  onMode(mode: 'outline' | 'thumbnails'): void
  onCollapse(): void
  position: 'left' | 'right' | 'overlay'
  onNavigate(destination: Destination, split: boolean): void
  onHover(request: PreviewRequest): void
  onLeave(): void
}) {
  return (
    <aside
      className="sidebar"
      id={`navigation-${loaded.descriptor.id}`}
      aria-label="Document navigation"
    >
      <div className="sidebar-header">
        <span>{mode === 'outline' ? 'CONTENTS' : 'PAGES'}</span>
        <div>
          <IconButton
            icon={ListTree}
            label="Document outline"
            active={mode === 'outline'}
            onClick={() => onMode('outline')}
          />
          <IconButton
            icon={Grid2X2}
            label="Page thumbnails"
            active={mode === 'thumbnails'}
            onClick={() => onMode('thumbnails')}
          />
          <IconButton
            icon={position === 'right' ? PanelRightClose : PanelLeftClose}
            label="Collapse sidebar"
            onClick={onCollapse}
          />
        </div>
      </div>
      <div className="sidebar-scroll">
        {mode === 'outline' ? (
          loaded.outline?.length ? (
            <OutlineItems
              items={loaded.outline}
              onNavigate={onNavigate}
              onHover={(destination, element) => {
                const { left, right, top, bottom } = element.getBoundingClientRect()
                element.setAttribute('aria-haspopup', 'dialog')
                element.setAttribute('aria-controls', 'link-preview')
                element.setAttribute('aria-keyshortcuts', 'Alt+ArrowDown')
                element.setAttribute(
                  'aria-description',
                  'Press Alt+ArrowDown or Tab to enter the link preview.',
                )
                onHover({
                  sourceId,
                  sourceElement: element,
                  destination,
                  rotation,
                  anchor: { left, right, top, bottom },
                })
              }}
              onLeave={onLeave}
            />
          ) : (
            <div className="sidebar-empty">
              <ListTree size={24} strokeWidth={1.3} />
              <p>This paper has no outline.</p>
              <button onClick={() => onMode('thumbnails')}>Browse its pages</button>
            </div>
          )
        ) : (
          <div className="thumbnail-list">
            {Array.from({ length: loaded.pdf.numPages }, (_, i) => (
              <Thumbnail
                key={i}
                loaded={loaded}
                pageNumber={i + 1}
                current={page === i + 1}
                onClick={() => onNavigate([i, { name: 'Fit' }], false)}
              />
            ))}
          </div>
        )}
      </div>
      <div className="sidebar-footnote">
        {loaded.pdf.numPages} pages <span>•</span> {(loaded.descriptor.size / 1_048_576).toFixed(1)}{' '}
        MB
      </div>
    </aside>
  )
}
