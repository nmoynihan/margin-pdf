import { AnnotationEditorType, AnnotationMode } from 'pdfjs-dist'
import {
  EventBus,
  PDFViewer,
  PDFLinkService,
  PDFFindController,
} from 'pdfjs-dist/web/pdf_viewer.mjs'
import { MAX_CANVAS_DIMENSION } from '../../../shared/limits'
import type { ReadingPosition } from '../../../shared/types'
import { NavigationHistory } from '../model/navigation'
import type { Destination, ResolvedDestination } from './destinations'
import type { LoadedDocument } from './engine'
import { readerHost } from '../host'
import type { SyncTarget } from '../../../shared/reader-host'
import { pagePointFromClient, pdfPointFromTopLeft, viewportRectFromTarget } from './synctex'

export interface PaneStatus {
  page: number
  count: number
  zoom: string
  scale: number
  rotation: number
  back: boolean
  forward: boolean
  matches: { current: number; total: number }
  finding: boolean
}
export interface LinkTarget {
  destination?: Destination
  url?: string
  action?: string
}

export class PaneController {
  readonly eventBus = new EventBus()
  readonly linkService = new PDFLinkService({
    eventBus: this.eventBus,
    ignoreDestinationZoom: true,
  })
  readonly findController = new PDFFindController({
    eventBus: this.eventBus,
    linkService: this.linkService,
  })
  readonly viewer: PDFViewer
  readonly history = new NavigationHistory()
  readonly ready: Promise<void>
  private annotationPages = new Map<number, Promise<Map<string, LinkTarget>>>()
  private abort = new AbortController()
  private disposed = false
  private position: ReadingPosition
  private matches = { current: 0, total: 0 }
  private finding = false
  private resizing = false
  private pagesInitialized = false
  private initialized = false
  private observer: ResizeObserver
  private resolveReady!: () => void
  private navigationRequest = 0
  private syncMarker?: HTMLDivElement
  private syncTimer?: ReturnType<typeof setTimeout>
  private syncRequest = 0

  constructor(
    readonly container: HTMLDivElement,
    readonly loaded: LoadedDocument,
    initial: ReadingPosition,
    private onUpdate: (status: PaneStatus, position: ReadingPosition) => void,
    private onLink: (destination: Destination, modified: boolean) => void,
    private onError: (message: string) => void,
  ) {
    this.position = { ...initial }
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve
    })
    // The distributed runtime supports abortSignal, although its option type omits it.
    const options = {
      container,
      viewer: container.firstElementChild as HTMLDivElement,
      eventBus: this.eventBus,
      linkService: this.linkService,
      findController: this.findController,
      annotationMode: AnnotationMode.ENABLE,
      annotationEditorMode: AnnotationEditorType.DISABLE,
      enableAutoLinking: false,
      maxCanvasPixels: 16_777_216,
      maxCanvasDim: MAX_CANVAS_DIMENSION,
      // Avoid temporary progress canvases surviving a zoom, tab swap or PDF reload.
      minDurationToUpdateCanvas: 0,
      abortSignal: this.abort.signal,
      imageResourcesPath: readerHost().assetUrl('images/'),
    }
    this.viewer = new PDFViewer(options)
    this.linkService.setViewer(this.viewer)
    this.linkService.setDocument(loaded.pdf)
    this.eventBus.on(
      'pagesinit',
      () => {
        if (this.disposed) return
        this.pagesInitialized = true
        this.initializeVisible()
      },
      { signal: this.abort.signal },
    )
    this.eventBus.on(
      'updateviewarea',
      ({ location }: { location: { pageNumber: number; left: number; top: number } }) => {
        if (this.disposed || !this.initialized || !container.clientWidth || !container.clientHeight)
          return
        this.position = {
          page: location.pageNumber,
          left: location.left,
          top: location.top,
          zoom: String(this.viewer.currentScaleValue || 'page-width'),
          rotation: this.viewer.pagesRotation,
        }
        this.emit()
      },
      { signal: this.abort.signal },
    )
    this.eventBus.on(
      'updatefindmatchescount',
      ({ matchesCount }: { matchesCount: PaneStatus['matches'] }) => {
        this.matches = matchesCount
        this.emit()
      },
      { signal: this.abort.signal },
    )
    this.eventBus.on(
      'updatefindcontrolstate',
      ({ state, matchesCount }: { state: number; matchesCount?: PaneStatus['matches'] }) => {
        this.finding = state === 3
        if (matchesCount) this.matches = matchesCount
        this.emit()
      },
      { signal: this.abort.signal },
    )
    this.eventBus.on(
      'annotationlayerrendered',
      ({ pageNumber }: { pageNumber: number }) => {
        void this.indexAnnotations(pageNumber)
      },
      { signal: this.abort.signal },
    )
    this.viewer.setDocument(loaded.pdf)
    this.observer = new ResizeObserver(() => {
      if (this.resizing || this.disposed || !container.clientWidth || !container.clientHeight)
        return
      if (!this.initialized) {
        this.initializeVisible()
        return
      }
      this.resizing = true
      requestAnimationFrame(() => {
        this.resizing = false
        if (this.disposed || !container.clientWidth || !container.clientHeight) return
        const saved = this.currentPosition()
        if (['page-width', 'page-fit', 'auto'].includes(saved.zoom)) {
          this.viewer.currentScaleValue = saved.zoom
          this.restore(saved)
        }
        this.viewer.update()
      })
    })
    this.observer.observe(container)
    container.addEventListener('click', this.captureClick, {
      capture: true,
      signal: this.abort.signal,
    })
    container.addEventListener(
      'contextmenu',
      (event) => {
        if (event.ctrlKey && (event.target as HTMLElement).closest('a')) this.captureClick(event)
      },
      { capture: true, signal: this.abort.signal },
    )
  }

  private initializeVisible() {
    if (
      this.initialized ||
      !this.pagesInitialized ||
      !this.container.clientWidth ||
      !this.container.clientHeight
    )
      return
    this.initialized = true
    this.restore({ ...this.position })
    this.resolveReady()
    this.emit()
  }

  currentPosition() {
    return { ...this.position }
  }
  status(): PaneStatus {
    return {
      page: this.viewer.currentPageNumber || this.position.page,
      count: this.loaded.pdf.numPages,
      zoom: String(this.viewer.currentScaleValue || this.position.zoom),
      scale: this.viewer.currentScale || 1,
      rotation: this.viewer.pagesRotation,
      back: this.history.canGoBack,
      forward: this.history.canGoForward,
      matches: this.matches,
      finding: this.finding,
    }
  }
  private emit() {
    if (!this.disposed) this.onUpdate(this.status(), this.currentPosition())
  }

  private indexAnnotations(pageNumber: number) {
    let result = this.annotationPages.get(pageNumber)
    if (!result) {
      result = this.loaded.pdf
        .getPage(pageNumber)
        .then((page) => page.getAnnotations({ intent: 'display' }))
        .then(
          (annotations) =>
            new Map(
              annotations
                .filter((a) => a.subtype === 'Link')
                .map((a) => [String(a.id), { destination: a.dest, url: a.url, action: a.action }]),
            ),
        )
      this.annotationPages.set(pageNumber, result)
      if (this.annotationPages.size > 50)
        this.annotationPages.delete(this.annotationPages.keys().next().value!)
      result.catch(() => this.annotationPages.delete(pageNumber))
    }
    return result
  }

  async targetFor(element: HTMLElement): Promise<LinkTarget | null> {
    const section = element.closest<HTMLElement>('[data-annotation-id]')
    const page = section?.closest<HTMLElement>('.page[data-page-number]')
    if (!section || !page) return null
    return (
      (await this.indexAnnotations(Number(page.dataset.pageNumber))).get(
        section.dataset.annotationId!,
      ) ?? null
    )
  }

  private captureClick = (event: MouseEvent) => {
    if (!(event.target as HTMLElement).closest('a')) {
      const host = readerHost()
      if (!host.syncToSource || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey)
        return
      const element = (event.target as HTMLElement).closest<HTMLElement>('.page[data-page-number]')
      if (!element || (event.target as HTMLElement).closest('input, button, select, textarea'))
        return
      const page = Number(element.dataset.pageNumber)
      const view = this.viewer.getPageView(page - 1)
      if (!view) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const point = pagePointFromClient(
        view.viewport,
        element.getBoundingClientRect(),
        event.clientX,
        event.clientY,
      )
      void host
        .syncToSource(this.loaded.descriptor.id, { page, ...point })
        .catch((error) => this.onError(error.message))
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    const element = event.target as HTMLElement
    void this.targetFor(element)
      .then((target) => {
        if (!target || this.disposed) return
        if (target.destination) this.onLink(target.destination, event.ctrlKey || event.metaKey)
        else if (target.url)
          void readerHost()
            .openExternal(target.url)
            .catch((error) => this.onError(error.message))
        else if (target.action) {
          const page = {
            NextPage: this.viewer.currentPageNumber + 1,
            PrevPage: this.viewer.currentPageNumber - 1,
            FirstPage: 1,
            LastPage: this.loaded.pdf.numPages,
          }[target.action]
          if (page)
            this.onLink(
              [Math.max(0, Math.min(this.loaded.pdf.numPages - 1, page - 1)), { name: 'Fit' }],
              event.ctrlKey || event.metaKey,
            )
          else if (target.action === 'GoBack') this.goBack()
          else if (target.action === 'GoForward') this.goForward()
        }
      })
      .catch((error) => this.onError(error.message))
  }

  async navigate(destination: Destination | ResolvedDestination) {
    const request = ++this.navigationRequest
    try {
      const resolved =
        'pageNumber' in Object(destination)
          ? (destination as ResolvedDestination)
          : await this.loaded.resolver.resolve(destination as Destination)
      await this.ready
      if (this.disposed || request !== this.navigationRequest) return
      this.history.checkpoint(this.currentPosition())
      this.viewer.scrollPageIntoView({
        pageNumber: resolved.pageNumber,
        destArray: resolved.explicit,
        ignoreDestinationZoom: true,
      })
      // Publish coordinates now, before a delayed scroll animation frame can
      // leave the saved snapshot behind the page number shown in the toolbar.
      this.viewer.update()
      this.emit()
    } catch (error) {
      if (!this.disposed && request === this.navigationRequest)
        this.onError((error as Error).message)
    }
  }

  async syncTo(target: SyncTarget) {
    const request = ++this.syncRequest
    await this.ready
    if (this.disposed || request !== this.syncRequest || target.page > this.loaded.pdf.numPages)
      return
    const page = await this.loaded.pdf.getPage(target.page)
    if (this.disposed || request !== this.syncRequest) return
    const [x, y] = pdfPointFromTopLeft(target.pageBox ?? page.view, target.x, target.y)
    await this.navigate([target.page - 1, { name: 'XYZ' }, x, y, null])
    if (this.disposed || request !== this.syncRequest) return
    this.syncMarker?.remove()
    clearTimeout(this.syncTimer)
    const view = this.viewer.getPageView(target.page - 1)
    if (!view) return
    const rect = viewportRectFromTarget(view.viewport, target)
    const marker = document.createElement('div')
    marker.className = 'synctex-indicator'
    marker.setAttribute('aria-hidden', 'true')
    Object.assign(marker.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
    view.div.append(marker)
    this.syncMarker = marker
    this.syncTimer = setTimeout(() => marker.remove(), 1800)
  }

  restore(position: ReadingPosition) {
    this.viewer.pagesRotation = position.rotation
    this.viewer.currentScaleValue = position.zoom
    const page = Math.min(this.loaded.pdf.numPages, Math.max(1, position.page))
    this.viewer.scrollPageIntoView({
      pageNumber: page,
      destArray: [page - 1, { name: 'XYZ' }, position.left, position.top || null, null],
      ignoreDestinationZoom: true,
      allowNegativeOffset: true,
    })
    this.position = { ...position, page }
    this.viewer.update()
  }
  goBack() {
    const target = this.history.back(this.currentPosition())
    if (target) this.restore(target)
    this.emit()
  }
  goForward() {
    const target = this.history.forward(this.currentPosition())
    if (target) this.restore(target)
    this.emit()
  }
  goToPage(page: number) {
    if (Number.isInteger(page) && page >= 1 && page <= this.loaded.pdf.numPages)
      void this.navigate([page - 1, { name: 'Fit' }])
  }
  zoom(value: string) {
    this.viewer.currentScaleValue = value
    this.viewer.update()
    this.emit()
  }
  zoomBy(multiplier: number) {
    this.zoom(String(Math.min(5, Math.max(0.25, this.viewer.currentScale * multiplier))))
  }
  rotate() {
    this.viewer.pagesRotation = (this.viewer.pagesRotation + 90) % 360
    this.viewer.update()
    this.emit()
  }
  find(query: string, again = false, previous = false, caseSensitive = false) {
    this.eventBus.dispatch('find', {
      source: this,
      type: again ? 'again' : '',
      query,
      caseSensitive,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    })
  }
  closeFind() {
    this.eventBus.dispatch('findbarclose', { source: this })
  }
  dispose() {
    clearTimeout(this.syncTimer)
    this.syncMarker?.remove()
    if (this.disposed) return
    this.disposed = true
    this.navigationRequest++
    this.resolveReady()
    this.observer.disconnect()
    this.abort.abort()
    // PDF.js can finish a queued getPage after cancellation and try to resume
    // its old page view. Retire this viewer's queue before cancelling its pages.
    const queue = this.viewer.renderingQueue
    if (queue) {
      queue.renderView = () => false
      queue.renderHighestPriority = () => {}
    }
    this.viewer.setDocument(null)
    this.linkService.setDocument(null)
    this.annotationPages.clear()
    // React owns the .pdfViewer wrapper. Keep it available when a refreshed PDF
    // attaches a new controller to this pane; only PDF.js's page nodes are disposable.
    this.container.firstElementChild?.replaceChildren()
  }
}
