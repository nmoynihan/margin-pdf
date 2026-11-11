import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FolderOpen,
  Plus,
  X,
  FileText,
  ArrowUpRight,
  Sun,
  Moon,
  Monitor,
  ArrowRight,
  Clock3,
  Upload,
  AlertCircle,
  Printer,
  Settings2,
} from 'lucide-react'
import {
  type AppCommand,
  type DocumentDescriptor,
  type SessionSnapshot,
  type TabSnapshot,
  type Theme,
  type Skin,
  type WorkspaceLayout,
  defaultLayout,
} from '../../shared/types'
import { sanitizeSession } from '../../shared/session'
import { zoomShortcut } from '../../shared/shortcuts'
import { DocumentTab, newTabSnapshot } from './components/DocumentTab'
import { preparePrint } from './pdf/printing'
import type { LoadedDocument } from './pdf/engine'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Brand, IconButton } from './components/Controls'
import { Options, type Preferences } from './components/Options'

interface OpenTab {
  descriptor: DocumentDescriptor
  initial: TabSnapshot
  fileError?: string
}

export default function App() {
  const [booting, setBooting] = useState(true)
  const [compact, setCompact] = useState(false)
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [recent, setRecent] = useState<DocumentDescriptor[]>([])
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [theme, setTheme] = useState<Theme>('system')
  const [skin, setSkin] = useState<Skin>('classic')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [layout, setLayout] = useState<WorkspaceLayout>(defaultLayout)
  const [preview, setPreview] = useState<Preferences | null>(null)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const [sidebar, setSidebar] = useState<'outline' | 'thumbnails' | null>('outline')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [platform, setPlatform] = useState('linux')
  const [printProgress, setPrintProgress] = useState<{
    done: number
    total: number
    dialog: boolean
  } | null>(null)
  const printJob = useRef<{ abort: AbortController; documentId: string } | null>(null)
  const printFocus = useRef<HTMLElement | null>(null)
  const printCancel = useRef<HTMLButtonElement>(null)
  const snapshots = useRef(new Map<string, TabSnapshot>())
  const current = useRef({ tabs, activeId, theme, skin, layout, sidebar, platform })
  current.current = { tabs, activeId, theme, skin, layout, sidebar, platform }
  const handlers = useRef(new Map<string, (command: AppCommand) => void>())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const initialized = useRef(false)
  const dragDepth = useRef(0)
  const commandRef = useRef<(command: AppCommand) => void>(() => {})
  const addFilesRef = useRef<(files: DocumentDescriptor[]) => void>(() => {})

  const notify = useCallback(
    (message: string) =>
      setError(message.replace(/^Error invoking remote method '[^']+': Error: /, '')),
    [],
  )
  const snapshot = useCallback(
    (): SessionSnapshot => ({
      version: 1,
      tabs: current.current.tabs.map(
        (tab) => snapshots.current.get(tab.descriptor.id) ?? tab.initial,
      ),
      activeDocumentId: current.current.activeId,
      theme: current.current.theme,
      skin: current.current.skin,
      layout: current.current.layout,
      sidebar: current.current.sidebar,
      rememberedTabs: [...snapshots.current.values()].slice(-100),
    }),
    [],
  )
  const scheduleSave = useCallback(() => {
    if (!initialized.current) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void window.desktop
        .saveSession(snapshot())
        .catch((reason) => notify(`Could not save your reading position: ${reason.message}`))
    }, 350)
  }, [snapshot, notify])
  const updateSnapshot = useCallback(
    (next: TabSnapshot) => {
      snapshots.current.set(next.documentId, next)
      scheduleSave()
    },
    [scheduleSave],
  )
  const registerHandler = useCallback(
    (id: string, handler: ((command: AppCommand) => void) | null) => {
      if (handler) handlers.current.set(id, handler)
      else handlers.current.delete(id)
    },
    [],
  )

  const addFiles = (files: DocumentDescriptor[]) => {
    if (!files.length) return
    setTabs((previous) => {
      const next = [...previous]
      for (const descriptor of files)
        if (!next.some((tab) => tab.descriptor.id === descriptor.id)) {
          const initial = snapshots.current.get(descriptor.id) ?? newTabSnapshot(descriptor.id)
          snapshots.current.set(descriptor.id, initial)
          next.push({ descriptor, initial })
        }
      return next
    })
    setRecent((previous) =>
      [...files]
        .reverse()
        .concat(previous.filter((file) => !files.some((open) => open.id === file.id)))
        .slice(0, 30),
    )
    setActiveId(files.at(-1)!.id)
  }
  addFilesRef.current = addFiles
  const choose = () => {
    void window.desktop
      .chooseFiles()
      .then(addFilesRef.current)
      .catch((reason) => notify(reason.message))
  }
  const openSample = () => {
    void window.desktop
      .openSample()
      .then(addFilesRef.current)
      .catch((reason) => notify(reason.message))
  }
  const reopen = (descriptor: DocumentDescriptor) => {
    void window.desktop
      .reopen(descriptor.id)
      .then((file) => addFilesRef.current([file]))
      .catch((reason) => notify(`This paper is no longer available. ${reason.message}`))
  }
  const print = async (loaded: LoadedDocument) => {
    if (printJob.current) return
    const abort = new AbortController()
    printJob.current = { abort, documentId: loaded.descriptor.id }
    printFocus.current = document.activeElement as HTMLElement | null
    setPrintProgress({ done: 0, total: loaded.pdf.numPages, dialog: false })
    let cleanup: (() => void) | undefined
    try {
      cleanup = await preparePrint(loaded, abort.signal, (done, total) =>
        setPrintProgress({ done, total, dialog: false }),
      )
      setPrintProgress({ done: loaded.pdf.numPages, total: loaded.pdf.numPages, dialog: true })
      const result = await window.desktop.print()
      if (!result.success && result.reason && !/cancel/i.test(result.reason)) notify(result.reason)
    } catch (reason) {
      if (!abort.signal.aborted) notify((reason as Error).message)
    } finally {
      cleanup?.()
      printJob.current = null
      setPrintProgress(null)
      if (printFocus.current?.isConnected) printFocus.current.focus({ preventScroll: true })
    }
  }
  const closeTab = (id: string) => {
    if (printJob.current?.documentId === id) {
      notify('Finish or cancel printing before closing this paper.')
      return
    }
    const previous = current.current.tabs
    const index = previous.findIndex((tab) => tab.descriptor.id === id)
    setTabs(previous.filter((tab) => tab.descriptor.id !== id))
    if (current.current.activeId === id)
      setActiveId(previous[index - 1]?.descriptor.id ?? previous[index + 1]?.descriptor.id ?? null)
  }
  commandRef.current = (command) => {
    const state = current.current
    if (document.querySelector('dialog[open]') && command !== 'options') return
    if (command === 'options') {
      if (!printJob.current) setOptionsOpen(true)
      return
    }
    if (command === 'print' && printJob.current) return
    if (command === 'open') choose()
    else if (command === 'close-tab' && state.activeId) closeTab(state.activeId)
    else if (command === 'next-tab' || command === 'previous-tab') {
      const index = state.tabs.findIndex((tab) => tab.descriptor.id === state.activeId)
      const next =
        (index + (command === 'next-tab' ? 1 : -1) + state.tabs.length) % state.tabs.length
      if (state.tabs[next]) setActiveId(state.tabs[next].descriptor.id)
    } else if (state.activeId) handlers.current.get(state.activeId)?.(command)
  }

  useEffect(() => {
    const remove = [
      window.desktop.onFiles((files) => addFilesRef.current(files)),
      window.desktop.onDocumentChanged((change) => {
        setTabs((previous) =>
          previous.map((tab) =>
            tab.descriptor.id === change.id
              ? { ...tab, descriptor: change.descriptor ?? tab.descriptor, fileError: change.error }
              : tab,
          ),
        )
        if (change.descriptor)
          setRecent((previous) =>
            previous.map((file) => (file.id === change.id ? change.descriptor! : file)),
          )
      }),
      window.desktop.onOpenError(notify),
      window.desktop.onCommand((command) => commandRef.current(command)),
      window.desktop.onSystemTheme(setSystemDark),
      window.desktop.onCompact(setCompact),
      window.desktop.onBeforeClose(snapshot),
    ]
    let alive = true
    void window.desktop
      .bootstrap()
      .then(async (boot) => {
        const restored = sanitizeSession(boot.session)
        for (const tab of [...restored.rememberedTabs, ...restored.tabs])
          snapshots.current.set(tab.documentId, tab)
        const results = await Promise.allSettled(
          restored.tabs.map((tab) => window.desktop.reopen(tab.documentId)),
        )
        if (!alive) return
        const restoredTabs = results.flatMap((result, index) =>
          result.status === 'fulfilled'
            ? [{ descriptor: result.value, initial: restored.tabs[index] }]
            : [],
        )
        for (const file of boot.launchFiles)
          if (!restoredTabs.some((tab) => tab.descriptor.id === file.id))
            restoredTabs.push({
              descriptor: file,
              initial: snapshots.current.get(file.id) ?? newTabSnapshot(file.id),
            })
        setTabs((previous) => [
          ...restoredTabs,
          ...previous.filter(
            (tab) => !restoredTabs.some((restored) => restored.descriptor.id === tab.descriptor.id),
          ),
        ])
        setActiveId(
          boot.launchFiles.at(-1)?.id ??
            (restoredTabs.some((tab) => tab.descriptor.id === restored.activeDocumentId)
              ? restored.activeDocumentId
              : (restoredTabs[0]?.descriptor.id ?? null)),
        )
        setRecent(boot.recent)
        setTheme(restored.theme)
        setSkin(restored.skin)
        setLayout(restored.layout)
        setSidebar(restored.sidebar)
        setSystemDark(boot.systemDark)
        setPlatform(boot.platform)
        setCompact(boot.compact)
        if (results.some((result) => result.status === 'rejected'))
          notify(
            'Some papers have moved or are no longer available. Open them again from disk to continue.',
          )
        if (boot.safeMode)
          notify(
            'Opened safely without restoring documents. Reopen a paper from Recent or Open PDF.',
          )
        initialized.current = true
        setBooting(false)
      })
      .catch((reason) => {
        if (alive) {
          notify(`Could not start the reader: ${reason.message}`)
          setBooting(false)
        }
      })
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return
      const shortcut = zoomShortcut(event, current.current.platform)
      if (shortcut) {
        event.preventDefault()
        commandRef.current(shortcut)
        return
      }
      if (event.key === 'Escape') {
        setError('')
        setDragging(false)
      }
      if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault()
        commandRef.current(event.key === 'ArrowLeft' ? 'back' : 'forward')
      }
    }
    window.addEventListener('keydown', key)
    return () => {
      alive = false
      remove.forEach((unsubscribe) => unsubscribe())
      clearTimeout(saveTimer.current)
      window.removeEventListener('keydown', key)
    }
  }, [notify, snapshot])
  useEffect(() => {
    if (!booting && initialized.current)
      void window.desktop.rendererReady().catch((reason) => notify(reason.message))
  }, [booting, notify])
  useEffect(() => {
    if (printProgress) printCancel.current?.focus()
  }, [Boolean(printProgress)])
  useEffect(
    () => () => {
      printJob.current?.abort.abort()
    },
    [],
  )
  useEffect(scheduleSave, [tabs, activeId, theme, skin, layout, sidebar, scheduleSave])
  const watchedIds = tabs.map((tab) => tab.descriptor.id).join(',')
  useEffect(() => {
    if (booting) return
    void window.desktop
      .watchDocuments(
        current.current.tabs.map(({ descriptor }) => ({
          id: descriptor.id,
          revision: descriptor.revision,
        })),
      )
      .catch((reason) => notify(reason.message))
  }, [watchedIds, booting, notify])
  useEffect(() => {
    const preferences = preview ?? { skin, theme, layout }
    const root = document.documentElement
    root.dataset.skin = preferences.skin
    root.dataset.theme =
      preferences.theme === 'system' ? (systemDark ? 'dark' : 'light') : preferences.theme
    root.dataset.controlsPosition = preferences.layout.controls
    root.dataset.tabsPosition = preferences.layout.tabs
    root.dataset.sidebarPosition = preferences.layout.sidebar
    root.dataset.documentToolsPosition = preferences.layout.documentTools
    root.dataset.pageControlsPosition = preferences.layout.pageControls
  }, [skin, theme, layout, preview, systemDark])
  useEffect(() => {
    document.title = activeId
      ? `${titles[activeId] ?? tabs.find((t) => t.descriptor.id === activeId)?.descriptor.name ?? 'Paper'} — Margin PDF`
      : 'Margin PDF'
  }, [activeId, titles, tabs])
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(''), 9000)
    return () => clearTimeout(timer)
  }, [error])

  const modifier = platform === 'darwin' ? '⌘' : 'Ctrl'
  return (
    <div
      className="app-shell"
      data-compact={compact}
      data-has-documents={tabs.length > 0}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          dragDepth.current++
          setDragging(true)
        }
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        dragDepth.current--
        if (dragDepth.current <= 0) {
          dragDepth.current = 0
          setDragging(false)
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(event) => {
        event.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        void window.desktop
          .openDropped(Array.from(event.dataTransfer.files))
          .then(addFilesRef.current)
          .catch((reason) => notify(reason.message))
      }}
    >
      <header className="app-header">
        <div className="app-wordmark">
          <Brand small />
          <span>
            <strong>Margin</strong> PDF
          </span>
        </div>
        <div className="header-actions">
          <button
            className="options-button"
            onClick={() => setOptionsOpen(true)}
            aria-haspopup="dialog"
            disabled={printProgress !== null}
          >
            <Settings2 size={15} />
            <span>Options</span>
          </button>
          <label className="theme-select" title="Colour theme">
            {theme === 'system' ? (
              <Monitor size={14} />
            ) : theme === 'dark' ? (
              <Moon size={14} />
            ) : (
              <Sun size={14} />
            )}
            <select
              aria-label="Colour theme"
              value={theme}
              onChange={(event) => setTheme(event.target.value as Theme)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <button className="open-button" onClick={choose}>
            <FolderOpen size={15} />
            Open PDF<span className="keyboard-hint">{modifier} O</span>
          </button>
        </div>
      </header>
      {tabs.length > 0 && (
        <nav className="tab-bar" aria-label="Open documents" role="tablist">
          {tabs.map((tab) => (
            <div
              className={`document-tab-button${tab.descriptor.id === activeId ? ' selected-tab' : ''}`}
              key={tab.descriptor.id}
            >
              <button
                role="tab"
                aria-selected={tab.descriptor.id === activeId}
                aria-controls={`tab-${tab.descriptor.id}`}
                title={tab.descriptor.name}
                onClick={() => setActiveId(tab.descriptor.id)}
              >
                <FileText size={14} />
                <span>
                  {titles[tab.descriptor.id] ?? tab.descriptor.name.replace(/\.pdf$/i, '')}
                </span>
              </button>
              <button
                className="close-tab"
                aria-label={`Close ${tab.descriptor.name}`}
                title="Close tab"
                onClick={() => closeTab(tab.descriptor.id)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <IconButton icon={Plus} label="Open another PDF" onClick={choose} />
        </nav>
      )}
      <main className="app-main">
        {booting ? (
          <div className="document-state">
            <span className="spinner large" />
            <p>Getting your desk ready…</p>
          </div>
        ) : tabs.length ? (
          tabs.map((tab) => (
            <div
              className="tab-panel"
              role="tabpanel"
              id={`tab-${tab.descriptor.id}`}
              key={tab.descriptor.id}
              hidden={tab.descriptor.id !== activeId}
            >
              <ErrorBoundary
                onClose={() => closeTab(tab.descriptor.id)}
                onRetry={() =>
                  setTabs((previous) =>
                    previous.map((open) =>
                      open.descriptor.id === tab.descriptor.id
                        ? {
                            ...open,
                            initial: snapshots.current.get(open.descriptor.id) ?? open.initial,
                          }
                        : open,
                    ),
                  )
                }
              >
                <DocumentTab
                  onPrint={(loaded) => void print(loaded)}
                  compact={compact}
                  secondaryActions={
                    <>
                      <label className="compact-document-switcher">
                        Document
                        <select
                          aria-label="Switch document"
                          value={activeId ?? ''}
                          onChange={(event) => setActiveId(event.target.value)}
                        >
                          {tabs.map((open) => (
                            <option key={open.descriptor.id} value={open.descriptor.id}>
                              {titles[open.descriptor.id] ?? open.descriptor.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button onClick={choose}>Open PDF…</button>
                      <button onClick={() => closeTab(tab.descriptor.id)}>Close document</button>
                      <button onClick={() => setOptionsOpen(true)}>Options…</button>
                      <button onClick={() => void window.desktop.setCompact(false)}>
                        Use full layout
                      </button>
                    </>
                  }
                  printing={printProgress !== null}
                  fileError={tab.fileError}
                  descriptor={tab.descriptor}
                  initial={tab.initial}
                  active={tab.descriptor.id === activeId}
                  sidebar={sidebar}
                  sidebarPosition={(preview?.layout ?? layout).sidebar}
                  onSidebar={setSidebar}
                  onSnapshot={updateSnapshot}
                  onTitle={(title) =>
                    setTitles((previous) =>
                      previous[tab.descriptor.id] === title
                        ? previous
                        : { ...previous, [tab.descriptor.id]: title },
                    )
                  }
                  onCommandHandler={registerHandler}
                  onError={notify}
                  onClose={() => closeTab(tab.descriptor.id)}
                />
              </ErrorBoundary>
            </div>
          ))
        ) : (
          <div className="welcome">
            <section className="home-open" aria-label="Open a PDF">
              <Brand />
              <button className="primary-button" onClick={choose}>
                <FolderOpen size={18} />
                Open PDF
                <ArrowRight size={16} />
              </button>
              <p>
                Drop a PDF here <span>·</span> {modifier} O
              </p>
              <button className="sample-button" onClick={openSample}>
                Open sample PDF <ArrowUpRight size={13} />
              </button>
            </section>
            {recent.length > 0 && (
              <section className="recent-section">
                <div className="recent-heading">
                  <h2>
                    <Clock3 size={15} />
                    Recent files
                  </h2>
                  <button
                    className="text-button"
                    onClick={() =>
                      void window.desktop
                        .clearRecent(snapshot())
                        .then(() => setRecent([]))
                        .catch((reason) => notify(reason.message))
                    }
                  >
                    Clear recent
                  </button>
                </div>
                <div className="recent-list">
                  {recent.slice(0, 8).map((file) => (
                    <button className="recent-file" key={file.id} onClick={() => reopen(file)}>
                      <span className="recent-file-icon">
                        <FileText size={20} strokeWidth={1.3} />
                      </span>
                      <span>
                        <strong>{file.name.replace(/\.pdf$/i, '')}</strong>
                        <small>
                          {file.location}
                          <span>·</span>
                          {(file.size / 1_048_576).toFixed(1)} MB
                        </small>
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
      {optionsOpen && (
        <Options
          current={{ skin, theme, layout }}
          onPreview={setPreview}
          onClose={() => {
            setOptionsOpen(false)
            setPreview(null)
          }}
          onSave={(preferences) => {
            setSkin(preferences.skin)
            setTheme(preferences.theme)
            setLayout(preferences.layout)
            setPreview(null)
            setOptionsOpen(false)
          }}
        />
      )}
      {printProgress && (
        <div
          className="modal-backdrop"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !printProgress.dialog) printJob.current?.abort.abort()
            if (event.key === 'Tab') {
              event.preventDefault()
              printCancel.current?.focus()
            }
          }}
        >
          <div
            className="print-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Prepare printing"
          >
            <Printer size={28} strokeWidth={1.4} />
            <h2>{printProgress.dialog ? 'Ready to print' : 'Preparing your paper'}</h2>
            <p aria-live="polite">
              {printProgress.dialog
                ? 'Choose your printer in the print dialog.'
                : `Rendering page ${printProgress.done} of ${printProgress.total}…`}
            </p>
            <progress
              aria-label="Pages prepared"
              value={printProgress.done}
              max={printProgress.total}
            />
            {!printProgress.dialog && (
              <button
                ref={printCancel}
                className="text-button"
                onClick={() => printJob.current?.abort.abort()}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
      <footer className="status-bar">
        <span>
          <span className="status-dot" />
          {tabs.length
            ? `${tabs.length} ${tabs.length === 1 ? 'paper' : 'papers'} open`
            : 'No PDF open'}
        </span>
        {tabs.length > 0 && (
          <span>
            Hover to preview<span className="status-separator">/</span>
            {platform === 'darwin' ? '⌘' : 'Ctrl'}+click to split
          </span>
        )}
      </footer>
      {error && (
        <div className="toast" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
          <IconButton icon={X} label="Dismiss message" onClick={() => setError('')} />
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <div>
            <Upload size={38} strokeWidth={1.3} />
            <h2>Make room for a new idea.</h2>
            <p>Drop your PDF to start reading.</p>
          </div>
        </div>
      )}
    </div>
  )
}
