import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
} from 'electron'
import { dirname, join, relative, resolve, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdir, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { ReaderStore } from './store'
import { DocumentMonitor } from './DocumentMonitor'
import type { AppCommand, DesktopEvents, IpcRequests } from '../shared/types'
import { productionCSP, validateArguments } from './security'
import { zoomShortcut } from '../shared/shortcuts'

const here = dirname(fileURLToPath(import.meta.url))
const developmentURL = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const userDataOverride = process.env.MARGIN_PDF_USER_DATA ?? process.env.PDF_JUNKIE_USER_DATA
if (userDataOverride) app.setPath('userData', resolve(userDataOverride))
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])
app.setName('Margin PDF')

// Reuse an existing profile so the rename preserves papers, positions and preferences.
if (!userDataOverride && !existsSync(join(app.getPath('userData'), 'reader-state.json'))) {
  const legacyProfile = ['PDF Junkie', 'pdf-junkie']
    .map((name) => join(app.getPath('appData'), name))
    .find((directory) => existsSync(join(directory, 'reader-state.json')))
  if (legacyProfile) app.setPath('userData', legacyProfile)
}

let window: BrowserWindow | null = null
let store: ReaderStore
let rendererReady = false
let closing = false
let quitting = false
let safeMode = process.argv.includes('--safe-mode')
let compact = process.argv.includes('--compact')

function setCompact(value: boolean) {
  compact = value
  const item = Menu.getApplicationMenu()?.getMenuItemById('compact-mode')
  if (item) item.checked = value
  send('compact-mode', value)
}
let nativePrinting = false
let draining = false

function send<K extends keyof DesktopEvents>(channel: K, value: DesktopEvents[K]) {
  window?.webContents.send(channel, value)
}
const nativePath = (value: string) => (/^file:/i.test(value) ? fileURLToPath(value) : value)
const isPdfArgument = (value: string) => {
  try {
    return !value.startsWith('-') && extname(nativePath(value)).toLowerCase() === '.pdf'
  } catch {
    return false
  }
}
let pendingPaths = process.argv.slice(app.isPackaged ? 1 : 2).filter(isPdfArgument)

async function openPaths(paths: string[]) {
  const descriptors = []
  for (const path of paths) {
    try {
      descriptors.push(await store.register(nativePath(path)))
    } catch (error) {
      send(
        'open-error',
        `Could not open ${path.split(/[\\/]/).at(-1)}: ${(error as Error).message}`,
      )
    }
  }
  return descriptors
}

async function drainPaths() {
  if (!rendererReady || draining) return
  draining = true
  try {
    while (rendererReady && pendingPaths.length) {
      const paths = pendingPaths.splice(0)
      const files = await openPaths(paths)
      if (rendererReady) send('files-opened', files)
      else pendingPaths.unshift(...paths)
    }
  } finally {
    draining = false
  }
}

function deliverPaths(paths: string[]) {
  pendingPaths.push(...paths)
  if (!rendererReady || !store) return
  void drainPaths()
  window?.show()
  window?.focus()
}

app.on('open-file', (event, path) => {
  event.preventDefault()
  deliverPaths([path])
})
const locked = app.requestSingleInstanceLock()
if (!locked) app.quit()
else {
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--compact')) setCompact(true)
    deliverPaths(argv.filter(isPdfArgument))
  })
  void app.whenReady().then(async () => {
    store = new ReaderStore(join(app.getPath('userData'), 'reader-state.json'))
    await store.load()
    const monitor = new DocumentMonitor(
      (id) => store.inspect(id),
      (change) => {
        send('document-changed', change)
      },
    )
    app.on('will-quit', () => monitor.stop())
    const assetRoot = resolve(here, '../renderer')
    protocol.handle('app', async (request) => {
      try {
        const url = new URL(request.url)
        if (url.host !== 'reader') return new Response('Not found', { status: 404 })
        const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
        const file = resolve(assetRoot, `.${pathname}`)
        const relation = relative(assetRoot, file)
        if (relation.startsWith('..') || relation.includes('\0'))
          return new Response('Forbidden', { status: 403 })
        const response = await net.fetch(pathToFileURL(file).toString())
        const headers = new Headers(response.headers)
        headers.set('Content-Security-Policy', productionCSP)
        return new Response(response.body, { status: response.status, headers })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    })
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    )

    session.defaultSession.setPermissionCheckHandler(() => false)

    const handle = <K extends keyof IpcRequests>(
      name: K,
      callback: (
        ...args: IpcRequests[K]['args']
      ) => IpcRequests[K]['result'] | Promise<IpcRequests[K]['result']>,
    ) => {
      ipcMain.handle(name, (event, ...args) => {
        const source = event.senderFrame?.url ?? ''
        const allowed =
          source === 'app://reader/index.html' ||
          Boolean(developmentURL && new URL(source).origin === new URL(developmentURL).origin)
        if (
          event.sender !== window?.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          !allowed
        )
          throw new Error('Untrusted application request')
        validateArguments(name, args)
        return callback(...(args as IpcRequests[K]['args']))
      })
    }
    handle('bootstrap', async () => {
      rendererReady = false
      monitor.stop()
      const paths = pendingPaths.splice(0)
      const launchFiles = await openPaths(paths)
      return {
        recent: await store.recent(),
        launchFiles,
        session: safeMode ? { ...store.session, tabs: [], activeDocumentId: null } : store.session,
        systemDark: nativeTheme.shouldUseDarkColors,
        platform: process.platform,
        safeMode,
        compact,
      }
    })
    handle('renderer-ready', () => {
      rendererReady = true
      send('compact-mode', compact)
      void drainPaths()
    })
    handle('restart', (safe) => restart(safe))
    handle('set-compact', setCompact)
    handle('choose-files', async () => {
      const result = await dialog.showOpenDialog(window!, {
        title: 'Open papers',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
      })
      return result.canceled ? [] : openPaths(result.filePaths)
    })
    handle('open-sample', async () => {
      const samples = join(app.getPath('userData'), 'Samples')
      await mkdir(samples, { recursive: true })
      const path = join(samples, 'Sample paper on PDF navigation.pdf')
      await copyFile(join(here, '../renderer/sample.pdf'), path)
      return openPaths([path])
    })
    handle('open-dropped', (paths: unknown) => {
      if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string'))
        throw new Error('Invalid file selection')
      return openPaths(paths)
    })
    handle('reopen', (id: string) => store.reopen(id))
    handle('read-document', (id: string) => store.read(id))
    handle('watch-documents', (documents) => monitor.setDocuments(documents))
    handle('save-session', (snapshot: unknown) => store.saveSession(snapshot))
    handle('ready-to-close', async (snapshot: unknown) => {
      await store.saveSession(snapshot)
      closing = true
      if (quitting) app.quit()
      else window?.close()
    })
    handle('clear-recent', (snapshot) => store.clearRecent(snapshot))
    handle('open-external', async (value: unknown) => {
      if (typeof value !== 'string' || value.length > 8192) throw new Error('Invalid link')
      const url = new URL(value)
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol))
        throw new Error('This link type is not supported.')
      await shell.openExternal(url.toString())
    })
    handle('print', async () => {
      if (nativePrinting) return { success: false, reason: 'A print job is already active.' }
      nativePrinting = true
      try {
        return await new Promise<{ success: boolean; reason?: string }>((resolvePrint) => {
          window!.webContents.print(
            { silent: false, printBackground: true },
            (success, failureReason) => resolvePrint({ success, reason: failureReason }),
          )
        })
      } finally {
        nativePrinting = false
      }
    })
    handle('toggle-fullscreen', () => window?.setFullScreen(!window.isFullScreen()))

    const command = (value: AppCommand) => () => send('app-command', value)
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
        {
          label: 'File',
          submenu: [
            { label: 'Open PDF…', accelerator: 'CmdOrCtrl+O', click: command('open') },
            { label: 'Close tab', accelerator: 'CmdOrCtrl+W', click: command('close-tab') },
            { type: 'separator' },
            { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: command('print') },
            { type: 'separator' },
            { role: process.platform === 'darwin' ? 'close' : 'quit' },
          ],
        },
        { role: 'editMenu' },
        {
          label: 'View',
          submenu: [
            { label: 'Options…', accelerator: 'CmdOrCtrl+,', click: command('options') },
            {
              id: 'compact-mode',
              label: 'Compact layout',
              type: 'checkbox',
              checked: compact,
              click: (item) => setCompact(item.checked),
            },
            { type: 'separator' },
            { label: 'Find in paper', accelerator: 'CmdOrCtrl+F', click: command('find') },
            { label: 'Zoom in', accelerator: 'CmdOrCtrl+Plus', click: command('zoom-in') },
            { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: command('zoom-out') },
            { label: 'Fit width', accelerator: 'CmdOrCtrl+0', click: command('fit-width') },
            { label: 'Rotate clockwise', accelerator: 'CmdOrCtrl+R', click: command('rotate') },
            { label: 'Split view', accelerator: 'CmdOrCtrl+\\', click: command('split') },
            { type: 'separator' },
            { role: 'togglefullscreen' },
            { label: 'Reopen without restoring documents', click: () => restart(true) },
            ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : []),
          ],
        },
        {
          label: 'Window',
          submenu: [
            { label: 'Next tab', accelerator: 'Ctrl+Tab', click: command('next-tab') },
            {
              label: 'Previous tab',
              accelerator: 'Ctrl+Shift+Tab',
              click: command('previous-tab'),
            },
            { role: 'minimize' },
            { role: 'zoom' },
          ],
        },
      ]),
    )

    function restart(safe: boolean, replace = false) {
      safeMode = safe
      rendererReady = false
      nativePrinting = false
      if (window && (replace || window.webContents.isCrashed())) {
        const previous = window
        createWindow()
        previous.destroy()
      } else window?.webContents.reload()
    }

    let recovering = false
    async function offerRecovery(unresponsive = false) {
      rendererReady = false
      nativePrinting = false
      if (!window || recovering) return
      recovering = true
      try {
        const { response } = await dialog.showMessageBox(window, {
          type: 'warning',
          title: 'Recover Margin PDF',
          message: unresponsive
            ? 'The reader is not responding.'
            : 'The reader stopped unexpectedly.',
          detail:
            'Reopen safely to start without restoring documents. Saved reading positions remain available.',
          buttons: unresponsive
            ? ['Reopen safely', 'Keep waiting', 'Close']
            : ['Reopen safely', 'Restore documents', 'Close'],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        })
        if (!window) return
        if (response === 0) restart(true, true)
        else if (response === 1 && !unresponsive) restart(false, true)
        else if (response === 2) {
          closing = true
          window.close()
        } else {
          rendererReady = true
          void drainPaths()
        }
      } finally {
        recovering = false
      }
    }

    function createWindow() {
      rendererReady = false
      closing = false
      window = new BrowserWindow({
        width: 1380,
        height: 920,
        minWidth: 760,
        minHeight: 560,
        show: false,
        title: 'Margin PDF',
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#171b22' : '#f4f5f7',
        autoHideMenuBar: process.platform !== 'darwin',
        icon: join(here, '../../resources/margin-pdf-icon.png'),
        webPreferences: {
          preload: join(here, '../preload/index.cjs'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          spellcheck: false,
        },
      })
      const createdWindow = window
      window.webContents.on('render-process-gone', (_event, details) => {
        if (window === createdWindow && details.reason !== 'clean-exit' && !closing)
          void offerRecovery()
      })
      window.on('unresponsive', () => {
        if (window === createdWindow) void offerRecovery(true)
      })
      window.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return
        const shortcut = zoomShortcut(
          {
            key: input.key,
            code: input.code,
            ctrlKey: input.control,
            metaKey: input.meta,
            altKey: input.alt,
            isComposing: input.isComposing,
          },
          process.platform,
        )
        if (!shortcut) return
        // Consume the key before menu/browser handling so each press zooms the PDF once.
        event.preventDefault()
        send('app-command', shortcut)
      })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      window.once('ready-to-show', () => window?.show())
      window.on('close', (event) => {
        if (!rendererReady || closing) return
        event.preventDefault()
        send('prepare-close', undefined)
        setTimeout(() => {
          if (window === createdWindow && !closing) {
            closing = true
            if (quitting) app.quit()
            else window.close()
          }
        }, 3000).unref()
      })
      window.on('closed', () => {
        if (window !== createdWindow) return
        monitor.stop()
        window = null
        rendererReady = false
      })
      if (developmentURL) void window.loadURL(developmentURL)
      else void window.loadURL('app://reader/index.html')
    }
    createWindow()
    nativeTheme.on('updated', () => send('system-theme', nativeTheme.shouldUseDarkColors))
    app.on('activate', () => {
      if (!window) createWindow()
      else window.show()
    })
  })
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => {
  quitting = true
})
