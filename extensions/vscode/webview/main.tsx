import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DocumentTab, newTabSnapshot } from '../../../src/renderer/src/components/DocumentTab'
import { ErrorBoundary } from '../../../src/renderer/src/components/ErrorBoundary'
import { Brand } from '../../../src/renderer/src/components/Controls'
import { configureReaderHost } from '../../../src/renderer/src/host'
import { zoomShortcut } from '../../../src/shared/shortcuts'
import type { AppCommand, DocumentDescriptor, TabSnapshot } from '../../../src/shared/types'
import type { ReaderState } from '../../../src/shared/vscode'
import type { SyncTarget } from '../../../src/shared/reader-host'
import { post, request, setState, subscribe, webviewHost } from './host'
import 'pdfjs-dist/web/pdf_viewer.css'
import '../../../src/renderer/src/styles.css'
import '../../../src/renderer/src/layouts.css'
import '../../../src/renderer/src/compact.css'
import './vscode.css'

configureReaderHost(webviewHost)
document.documentElement.dataset.sidebarPosition = 'overlay'
const testMode =
  document.querySelector<HTMLMetaElement>('meta[name="margin-testing"]')?.content === 'true'
const errors: string[] = []
if (testMode) window.addEventListener('error', (event) => errors.push(event.message))

function Reader() {
  const [boot, setBoot] = useState<{ descriptor: DocumentDescriptor; state?: ReaderState }>()
  const [descriptor, setDescriptor] = useState<DocumentDescriptor>()
  const [sidebar, setSidebar] = useState<ReaderState['sidebar']>(null)
  const [fileError, setFileError] = useState<string>()
  const [error, setError] = useState('')
  const [target, setTarget] = useState<SyncTarget>()
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null)
  const [paneToolbarTarget, setPaneToolbarTarget] = useState<HTMLDivElement | null>(null)
  const [statusTarget, setStatusTarget] = useState<HTMLDivElement | null>(null)
  const handler = useRef<(command: AppCommand) => void>(() => {})
  const state = useRef<ReaderState | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const save = useCallback(() => {
    if (!state.current) return
    setState(state.current)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (state.current)
        void request('save', state.current).catch((reason) => setError(reason.message))
    }, 350)
  }, [])
  const snapshot = useCallback(
    (snapshot: TabSnapshot) => {
      state.current = { snapshot, sidebar: state.current?.sidebar ?? null }
      save()
    },
    [save],
  )
  const register = useCallback((_id: string, command: ((command: AppCommand) => void) | null) => {
    handler.current = command ?? (() => {})
  }, [])
  useEffect(() => {
    let alive = true
    void request('bootstrap', undefined)
      .then((value) => {
        if (!alive) return
        state.current = value.state ?? {
          snapshot: newTabSnapshot(value.descriptor.id),
          sidebar: null,
        }
        setBoot(value)
        setDescriptor(value.descriptor)
        setSidebar(state.current.sidebar)
        post({ type: 'ready' })
      })
      .catch((reason) => setError(reason.message))
    const remove = subscribe((message) => {
      if (message.type === 'change') {
        if (message.change.descriptor) setDescriptor(message.change.descriptor)
        setFileError(message.change.error)
      }
      if (message.type === 'sync') setTarget(message.target)
      if (message.type === 'probe' && testMode) {
        if (message.action === 'command') handler.current(message.value as AppCommand)
        if (message.action === 'click') {
          const {
            selector,
            ctrl = false,
            x,
            y,
          } = message.value as { selector: string; ctrl?: boolean; x?: number; y?: number }
          const element = document.querySelector<HTMLElement>(selector)
          const rect = element?.getBoundingClientRect()
          element?.dispatchEvent(
            new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              ctrlKey: ctrl,
              clientX: x ?? (rect ? rect.left + rect.width / 2 : 0),
              clientY: y ?? (rect ? rect.top + rect.height / 2 : 0),
            }),
          )
        }
        if (message.action === 'hover') {
          const anchor = document.querySelector<HTMLElement>(String(message.value))
          anchor?.focus({ preventScroll: true })
          anchor?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
        }
        if (message.action === 'page') {
          const input = document.querySelector<HTMLInputElement>(
            '.vscode-header input[aria-label="Page number"]',
          )
          if (input) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
              input,
              String(message.value),
            )
            input.dispatchEvent(new Event('input', { bubbles: true }))
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
          }
        }
        const canvas = [...document.querySelectorAll<HTMLCanvasElement>('.reader-pane canvas')]
        post({
          type: 'probe-result',
          id: message.id,
          value: {
            ready: true,
            canvases: canvas.filter((c) => c.width && c.height).length,
            revision: document.querySelector('.document-tab')?.getAttribute('data-loaded-revision'),
            pixel: canvas[0]?.getContext('2d')
              ? Array.from(
                  canvas[0]
                    .getContext('2d')!
                    .getImageData(
                      Math.floor(canvas[0].width / 2),
                      Math.floor(canvas[0].height / 2),
                      1,
                      1,
                    ).data,
                )
              : [],
            state: state.current,
            error: document.querySelector('[role="alert"]')?.textContent ?? error,
            fileStatus: document.querySelector('.file-update-banner')?.textContent,
            indicators: document.querySelectorAll('.synctex-indicator').length,
            previews: document.querySelectorAll('.link-preview').length,
            links: document.querySelectorAll('.reader-pane .linkAnnotation a').length,
            overflow: document.documentElement.scrollWidth > window.innerWidth,
            bodyClass: document.body.className,
            headerHeight: document.querySelector('.vscode-header')?.getBoundingClientRect().height,
            inlineStatus: !!document.querySelector('.vscode-header .file-update-banner'),
            innerToolbars: document.querySelectorAll(
              '.document-tab .document-toolbar, .reader-pane .pane-toolbar',
            ).length,
            paneNames: document.querySelectorAll('.pane-label').length,
            titleVisible: !!document.querySelector('.document-heading')?.getBoundingClientRect()
              .width,
            clippedControls: [
              ...document.querySelectorAll<HTMLElement>(
                '.vscode-header button, .vscode-header input, .vscode-header select, .vscode-header summary',
              ),
            ]
              .filter(
                (element) =>
                  !element.closest('.reader-overflow-content') &&
                  element.getBoundingClientRect().width,
              )
              .some((element) => {
                const bounds = element.getBoundingClientRect()
                return bounds.left < 0 || bounds.right > innerWidth + 1 || bounds.bottom > 43
              }),
            errors,
          },
        })
      }
    })
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,select,textarea')) return
      const modifier = event.ctrlKey || event.metaKey
      const command =
        zoomShortcut(event, navigator.platform.includes('Mac') ? 'darwin' : 'linux') ??
        (modifier && event.key.toLowerCase() === 'f'
          ? 'find'
          : modifier && event.code === 'Backslash'
            ? 'split'
            : event.altKey && event.key === 'ArrowLeft'
              ? 'back'
              : event.altKey && event.key === 'ArrowRight'
                ? 'forward'
                : undefined)
      if (command) {
        event.preventDefault()
        handler.current(command)
      }
    }
    window.addEventListener('keydown', key)
    return () => {
      alive = false
      remove()
      window.removeEventListener('keydown', key)
      clearTimeout(timer.current)
    }
  }, [])
  return (
    <div className="vscode-reader">
      <header className="vscode-header" aria-label="PDF controls">
        <Brand small />
        <div className="vscode-pane-tools" ref={setPaneToolbarTarget} />
        <div className="vscode-status" ref={setStatusTarget} />
        <div className="vscode-document-tools" ref={setToolbarTarget} />
      </header>
      {boot && descriptor ? (
        <ErrorBoundary>
          <DocumentTab
            descriptor={descriptor}
            initial={boot.state?.snapshot ?? newTabSnapshot(descriptor.id)}
            active
            compact
            toolbarTarget={toolbarTarget}
            paneToolbarTarget={paneToolbarTarget}
            statusTarget={statusTarget}
            sidebar={sidebar}
            sidebarPosition="overlay"
            onSidebar={(value) => {
              setSidebar(value)
              if (state.current) state.current.sidebar = value
              save()
            }}
            onSnapshot={snapshot}
            onTitle={() => {}}
            onCommandHandler={register}
            onError={setError}
            onClose={() => {
              void request('close', undefined)
            }}
            onPrint={() => {}}
            printing={false}
            fileError={fileError}
            syncTarget={target}
            secondaryActions={
              <span className="sync-hint">
                Ctrl+click PDF content to reveal its source.
                <br />
                Ctrl+click links to open the other pane.
              </span>
            }
          />
        </ErrorBoundary>
      ) : (
        <div className="document-state" role="status">
          {error || 'Opening PDF…'}
        </div>
      )}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss message" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Reader />)
