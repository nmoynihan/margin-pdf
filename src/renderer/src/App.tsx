import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FolderOpen,
  Plus,
  X,
  FileText,
  ArrowUpRight,
  Link as LinkIcon,
  Columns2,
  Sun,
  Moon,
  Monitor,
  ArrowRight,
  Clock3,
  Upload,
  AlertCircle,
} from 'lucide-react'
import {
  type AppCommand,
  type DocumentDescriptor,
  type SessionSnapshot,
  type TabSnapshot,
  type Theme,
} from '../../shared/types'
import { sanitizeSession } from '../../shared/session'
import { DocumentTab, newTabSnapshot } from './components/DocumentTab'
import { Brand, IconButton } from './components/Controls'

interface OpenTab {
  descriptor: DocumentDescriptor
  initial: TabSnapshot
}

export default function App() {
  const [booting, setBooting] = useState(true)
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [recent, setRecent] = useState<DocumentDescriptor[]>([])
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [theme, setTheme] = useState<Theme>('system')
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const [sidebar, setSidebar] = useState<'outline' | 'thumbnails' | null>('outline')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [platform, setPlatform] = useState('linux')
  const snapshots = useRef(new Map<string, TabSnapshot>())
  const current = useRef({ tabs, activeId, theme, sidebar })
  current.current = { tabs, activeId, theme, sidebar }
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
  const closeTab = (id: string) => {
    const previous = current.current.tabs
    const index = previous.findIndex((tab) => tab.descriptor.id === id)
    setTabs(previous.filter((tab) => tab.descriptor.id !== id))
    if (current.current.activeId === id)
      setActiveId(previous[index - 1]?.descriptor.id ?? previous[index + 1]?.descriptor.id ?? null)
  }
  commandRef.current = (command) => {
    const state = current.current
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
      window.desktop.onOpenError(notify),
      window.desktop.onCommand((command) => commandRef.current(command)),
      window.desktop.onSystemTheme(setSystemDark),
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
        setTabs(restoredTabs)
        setActiveId(
          boot.launchFiles.at(-1)?.id ??
            (restoredTabs.some((tab) => tab.descriptor.id === restored.activeDocumentId)
              ? restored.activeDocumentId
              : (restoredTabs[0]?.descriptor.id ?? null)),
        )
        setRecent(boot.recent)
        setTheme(restored.theme)
        setSidebar(restored.sidebar)
        setSystemDark(boot.systemDark)
        setPlatform(boot.platform)
        if (results.some((result) => result.status === 'rejected'))
          notify(
            'Some papers have moved or are no longer available. Open them again from disk to continue.',
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
  useEffect(scheduleSave, [tabs, activeId, theme, sidebar, scheduleSave])
  useEffect(() => {
    document.documentElement.dataset.theme =
      theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
  }, [theme, systemDark])
  useEffect(() => {
    document.title = activeId
      ? `${titles[activeId] ?? tabs.find((t) => t.descriptor.id === activeId)?.descriptor.name ?? 'Paper'} — PDF Junkie`
      : 'PDF Junkie'
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
            PDF <strong>Junkie</strong>
          </span>
          <span className="app-label">READER</span>
        </div>
        <div className="header-actions">
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
              <DocumentTab
                descriptor={tab.descriptor}
                initial={tab.initial}
                active={tab.descriptor.id === activeId}
                sidebar={sidebar}
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
            </div>
          ))
        ) : (
          <div className="welcome">
            <div className="welcome-main">
              <div className="welcome-copy">
                <div className="eyebrow">
                  <span /> MADE FOR DEEP READING
                </div>
                <h1>
                  Keep your place.
                  <br />
                  <span>Follow the reference.</span>
                </h1>
                <p>
                  Your paper, with a little more room to think.
                  <br />
                  Peek at references and read two places at once.
                </p>
                <button className="primary-button" onClick={choose}>
                  <FolderOpen size={17} />
                  Open a paper
                  <ArrowRight size={16} />
                </button>
                <div className="welcome-drop">
                  or drop a PDF anywhere <span>·</span> {modifier} O
                </div>
                <button className="sample-button" onClick={openSample}>
                  Explore with a sample paper <ArrowUpRight size={13} />
                </button>
              </div>
              <div className="welcome-cards">
                <div className="feature-card">
                  <div className="feature-icon">
                    <LinkIcon size={19} />
                  </div>
                  <div>
                    <h2>A reference, within reach.</h2>
                    <p>
                      Hover over a link to peek at the source.
                      <br />
                      Keep the thought. Skip the detour.
                    </p>
                  </div>
                  <div className="reference-demo">
                    <span>
                      …as shown in <span className="demo-citation">Figure 2</span>, the results…
                    </span>
                    <div className="demo-popover">
                      <div className="demo-graph">
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                      </div>
                      <span>Figure 2. A closer look.</span>
                    </div>
                  </div>
                </div>
                <div className="feature-card split-feature">
                  <div className="feature-icon">
                    <Columns2 size={19} />
                  </div>
                  <div>
                    <h2>Two places. One paper.</h2>
                    <p>
                      Ctrl+click a link to open its destination
                      <br />
                      beside your current page.
                    </p>
                  </div>
                  <div className="split-demo">
                    <div>
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                    <div>
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                    <span className="demo-divider" />
                  </div>
                </div>
              </div>
            </div>
            <section className="recent-section">
              <div className="recent-heading">
                <h2>
                  <Clock3 size={15} />
                  Recently opened
                </h2>
                {recent.length > 0 && (
                  <button
                    className="text-button"
                    onClick={() =>
                      void window.desktop
                        .clearRecent()
                        .then(() => setRecent([]))
                        .catch((reason) => notify(reason.message))
                    }
                  >
                    Clear recent
                  </button>
                )}
              </div>
              {recent.length ? (
                <div className="recent-list">
                  {recent.slice(0, 8).map((file) => (
                    <button className="recent-file" key={file.id} onClick={() => reopen(file)}>
                      <span className="recent-file-icon">
                        <FileText size={20} strokeWidth={1.3} />
                      </span>
                      <span>
                        <strong>{file.name.replace(/\.pdf$/i, '')}</strong>
                        <small>
                          {file.location} <span>·</span> {(file.size / 1_048_576).toFixed(1)} MB
                        </small>
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="recent-empty">
                  <FileText size={17} />
                  <span>Your papers will be here, ready to pick up where you left off.</span>
                </div>
              )}
            </section>
            <footer className="welcome-footer">
              <span>YOUR PAPERS. YOUR DEVICE.</span>
              <span>Local files. A quiet workspace.</span>
            </footer>
          </div>
        )}
      </main>
      <footer className="status-bar">
        <span>
          <span className="status-dot" />
          {tabs.length
            ? `${tabs.length} ${tabs.length === 1 ? 'paper' : 'papers'} open`
            : 'Ready when you are'}
        </span>
        <span>
          Hover to preview<span className="status-separator">/</span>
          {platform === 'darwin' ? '⌘' : 'Ctrl'}+click to split
        </span>
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
