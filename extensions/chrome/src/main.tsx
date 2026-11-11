import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Download, Settings2, X } from 'lucide-react'
import { Brand, IconButton } from '../../../src/renderer/src/components/Controls'
import { DocumentTab, newTabSnapshot } from '../../../src/renderer/src/components/DocumentTab'
import { ErrorBoundary } from '../../../src/renderer/src/components/ErrorBoundary'
import { configureReaderHost } from '../../../src/renderer/src/host'
import { preparePrint } from '../../../src/renderer/src/pdf/printing'
import type { LoadedDocument } from '../../../src/renderer/src/pdf/engine'
import type { AppCommand, TabSnapshot } from '../../../src/shared/types'
import { MAX_DOCUMENT_BYTES } from '../../../src/shared/limits'
import { zoomShortcut } from '../../../src/shared/shortcuts'
import { chromeAPI } from './chrome'
import {
  describeBytes,
  pageFromHash,
  pdfName,
  readPdfResponse,
  type BrowserDocument,
} from './documents'
import { browserHost, setCurrentDocument } from './host'
import {
  defaultPreferences,
  forgetPositions,
  readPosition,
  readPreferences,
  savePosition,
  type Preferences,
} from './storage'
import { Settings } from './Settings'
import 'pdfjs-dist/web/pdf_viewer.css'
import '../../../src/renderer/src/styles.css'
import '../../../src/renderer/src/skins.css'
import '../../../src/renderer/src/layouts.css'
import '../../../src/renderer/src/compact.css'
import './reader.css'

configureReaderHost(browserHost)
document.documentElement.dataset.sidebarPosition = 'overlay'
const nativePage = location.pathname.endsWith('/viewer.html')

// Chrome's stream URL can be consumed exactly once. Cache the bootstrap promise,
// including a rejection, so a React remount can never trigger a second fetch.
let nativeDocument: Promise<BrowserDocument> | undefined
function openNative(): Promise<BrowserDocument> {
  return (nativeDocument ??= (async () => {
    if (!chromeAPI.mimeHandler) throw new Error('PDF integration requires Chrome 151 or later.')
    const stream = await chromeAPI.mimeHandler.getStreamInfo()
    const bytes = await readPdfResponse(await fetch(stream.streamUrl))
    const url = new URL(stream.originalUrl)
    const descriptor = await describeBytes(
      bytes,
      pdfName(url.href),
      url.protocol === 'file:' ? 'Local PDF' : url.hostname || 'PDF document',
    )
    const initial = newTabSnapshot(descriptor.id)
    const page = pageFromHash(url.hash) ?? pageFromHash(location.hash)
    if (page) initial.panes[0].position.page = page
    return { bytes, descriptor, native: true, initial: page ? initial : undefined }
  })())
}

function Reader() {
  const [source, setSource] = useState<BrowserDocument>()
  const [opening, setOpening] = useState(nativePage)
  const [preferences, setPreferences] = useState(defaultPreferences)
  const [ready, setReady] = useState(false)
  const [sidebar, setSidebar] = useState<'outline' | 'thumbnails' | null>(null)
  const [settings, setSettings] = useState(new URLSearchParams(location.search).has('settings'))
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number }>()
  const fileInput = useRef<HTMLInputElement>(null)
  const printDialog = useRef<HTMLDialogElement>(null)
  const printFocus = useRef<HTMLElement | null>(null)
  const handler = useRef<(command: AppCommand) => void>(() => {})
  const currentSnapshot = useRef<TabSnapshot | undefined>(undefined)
  const currentPreferences = useRef(preferences)
  currentPreferences.current = preferences
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const job = useRef<AbortController | undefined>(undefined)
  const openingSequence = useRef(0)
  const [instance, setInstance] = useState(0)
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null)
  const [paneToolbarTarget, setPaneToolbarTarget] = useState<HTMLDivElement | null>(null)
  const printing = !!progress
  useEffect(() => {
    if (!printing) return
    const dialog = printDialog.current!
    dialog.showModal()
    return () => {
      dialog.close()
      printFocus.current?.focus({ preventScroll: true })
    }
  }, [printing])

  const adopt = useCallback(async (value: BrowserDocument, prefs: Preferences) => {
    const saved = prefs.remember ? await readPosition(value.descriptor.id) : undefined
    value.initial ??= saved ?? newTabSnapshot(value.descriptor.id)
    clearTimeout(saveTimer.current)
    currentSnapshot.current = value.initial
    setCurrentDocument(value)
    setSource(value)
    setSidebar(null)
    setInstance((number) => number + 1)
    setError('')
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const prefs = await readPreferences()
        if (!alive) return
        setPreferences(prefs)
        setReady(true)
        if (nativePage) {
          const value = await openNative()
          if (alive) await adopt(value, prefs)
        }
      } catch (reason) {
        if (alive) setError((reason as Error).message)
      } finally {
        if (alive) setOpening(false)
      }
    })()
    return () => {
      alive = false
      clearTimeout(saveTimer.current)
      job.current?.abort()
    }
  }, [adopt])

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme =
        preferences.theme === 'system' ? (media.matches ? 'dark' : 'light') : preferences.theme
      document.documentElement.dataset.skin = preferences.skin
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [preferences.theme, preferences.skin])

  const persist = useCallback((snapshot: TabSnapshot) => {
    currentSnapshot.current = snapshot
    clearTimeout(saveTimer.current)
    if (currentPreferences.current.remember)
      saveTimer.current = setTimeout(
        () => void savePosition(snapshot).catch((reason) => setError(reason.message)),
        400,
      )
  }, [])
  useEffect(() => {
    const save = () => {
      clearTimeout(saveTimer.current)
      if (currentSnapshot.current && currentPreferences.current.remember)
        void savePosition(currentSnapshot.current).catch(() => {})
    }
    window.addEventListener('pagehide', save)
    const visibility = () => {
      if (document.visibilityState === 'hidden') save()
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])

  const register = useCallback((_id: string, command: ((command: AppCommand) => void) | null) => {
    handler.current = command ?? (() => {})
  }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        if (!job.current) fileInput.current?.click()
        return
      }
      if ((event.target as HTMLElement).closest('input,select,textarea,[contenteditable]')) return
      const command =
        zoomShortcut(event, navigator.platform.includes('Mac') ? 'darwin' : 'linux') ??
        (modifier && event.key.toLowerCase() === 'f'
          ? 'find'
          : modifier && event.key.toLowerCase() === 'p'
            ? 'print'
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
    return () => window.removeEventListener('keydown', key)
  }, [])

  const openFile = async (file: File) => {
    if (job.current || opening) return
    const sequence = ++openingSequence.current
    setOpening(true)
    try {
      if (file.size > MAX_DOCUMENT_BYTES)
        throw new Error('PDFs larger than 128 MiB are not supported.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const descriptor = await describeBytes(bytes, file.name, 'Local PDF')
      if (sequence === openingSequence.current)
        await adopt({ bytes, descriptor, native: false }, currentPreferences.current)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      if (sequence === openingSequence.current) setOpening(false)
    }
  }
  const sample = async () => {
    setOpening(true)
    try {
      const bytes = await readPdfResponse(await fetch(chromeAPI.runtime.getURL('sample.pdf')))
      const descriptor = await describeBytes(bytes, 'Sample paper.pdf', 'Bundled sample')
      await adopt({ bytes, descriptor, native: false }, currentPreferences.current)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setOpening(false)
    }
  }
  const download = () => {
    if (!source) return
    const url = URL.createObjectURL(new Blob([source.bytes], { type: 'application/pdf' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download =
      source.descriptor.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'Document.pdf'
    if (!/\.pdf$/i.test(anchor.download)) anchor.download += '.pdf'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  const print = async (loaded: LoadedDocument) => {
    if (job.current) return
    const abort = new AbortController()
    job.current = abort
    let cleanup: (() => void) | undefined
    printFocus.current = document.activeElement as HTMLElement | null
    setProgress({ done: 0, total: loaded.pdf.numPages })
    try {
      cleanup = await preparePrint(loaded, abort.signal, (done, total) =>
        setProgress({ done, total }),
      )
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      abort.signal.throwIfAborted()
      window.print()
    } catch (reason) {
      if (!abort.signal.aborted) setError((reason as Error).message)
    } finally {
      cleanup?.()
      job.current = undefined
      setProgress(undefined)
    }
  }
  const changePreferences = (next: Preferences) => {
    currentPreferences.current = next
    if (!next.remember) clearTimeout(saveTimer.current)
    setPreferences(next)
    void chromeAPI.storage.local
      .set({ preferences: next })
      .then(() => (next.remember ? undefined : forgetPositions()))
      .catch((reason) => setError(reason.message))
  }
  const fallback = () =>
    void chromeAPI.mimeHandler
      ?.abortAndFallbackToNativeHandler()
      .catch((reason) => setError(reason.message))

  return (
    <div
      className="browser-reader"
      data-has-document={Boolean(source)}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(event) => {
        event.preventDefault()
        const file = event.dataTransfer.files[0]
        if (file) void openFile(file)
      }}
    >
      <header className="browser-header">
        <span className="app-wordmark" aria-label="Margin PDF">
          <Brand small />
          <span className="browser-brand-name">Margin PDF</span>
        </span>
        <div className="browser-pane-tools" ref={setPaneToolbarTarget} />
        <div className="browser-document-tools" ref={setToolbarTarget} />
        <div className="browser-header-actions">
          {source && (
            <IconButton
              className="browser-download"
              icon={Download}
              label="Download PDF"
              onClick={download}
            />
          )}
          <IconButton
            icon={Settings2}
            label="Reader settings"
            disabled={!ready || !!progress}
            onClick={() => setSettings(true)}
          />
        </div>
      </header>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        aria-label="Choose PDF file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void openFile(file)
        }}
      />
      <main className="browser-main" aria-label="PDF reader">
        {source ? (
          <ErrorBoundary key={instance}>
            <DocumentTab
              descriptor={source.descriptor}
              compact
              toolbarTarget={toolbarTarget}
              paneToolbarTarget={paneToolbarTarget}
              secondaryActions={
                <button className="overflow-download" onClick={download}>
                  Download PDF
                </button>
              }
              initial={source.initial!}
              active
              sidebar={sidebar}
              sidebarPosition="overlay"
              onSidebar={setSidebar}
              onSnapshot={persist}
              onTitle={(title) => {
                document.title = `${title} — Margin PDF`
              }}
              onCommandHandler={register}
              onError={setError}
              onClose={() => {
                setSource(undefined)
                setCurrentDocument(undefined)
              }}
              onPrint={(loaded) => void print(loaded)}
              printing={!!progress}
              reloadLabel="Reload PDF"
            />
          </ErrorBoundary>
        ) : opening ? (
          <div className="document-state" role="status">
            Opening PDF…
          </div>
        ) : (
          <div className="browser-welcome">
            <Brand />
            <h1>
              Keep your place.
              <br />
              Follow the idea.
            </h1>
            <p>
              Preview a reference. Read two pages side by side.
              <br />
              Stay with the paper, wherever it takes you.
            </p>
            {nativePage ? (
              <>
                <p role="alert">{error || 'Chrome could not open this PDF in Margin PDF.'}</p>
                <button className="primary-button" onClick={fallback}>
                  Open in Chrome’s PDF viewer
                </button>
              </>
            ) : (
              <>
                <button
                  className="primary-button"
                  disabled={!ready || opening}
                  onClick={() => fileInput.current?.click()}
                >
                  Open a PDF
                </button>
                <button
                  className="text-button"
                  disabled={!ready || opening}
                  onClick={() => void sample()}
                >
                  Open sample PDF
                </button>
                <p className="browser-hint">
                  Drop a PDF here, or open a PDF link in Chrome.
                  <br />
                  Your documents stay on your device.
                </p>
              </>
            )}
          </div>
        )}
      </main>
      <footer className="browser-footer">
        <span>Hover links to preview · Ctrl / ⌘ click to open the other pane</span>
        {nativePage && (!source || source.native) && (
          <button onClick={fallback} disabled={!!progress}>
            Chrome viewer
          </button>
        )}
        <a href={chromeAPI.runtime.getURL('privacy.html')} target="_blank" rel="noreferrer">
          Privacy
        </a>
      </footer>
      {settings && ready && (
        <Settings
          preferences={preferences}
          onChange={changePreferences}
          onClose={() => setSettings(false)}
          onError={setError}
        />
      )}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="icon-button" aria-label="Dismiss message" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {progress && (
        <dialog
          ref={printDialog}
          className="browser-print-progress"
          aria-label="Prepare printing"
          onCancel={(event) => {
            event.preventDefault()
            job.current?.abort()
          }}
        >
          <p>
            Preparing print · {progress.done} / {progress.total} pages
          </p>
          <button className="text-button" autoFocus onClick={() => job.current?.abort()}>
            Cancel
          </button>
        </dialog>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Reader />)
