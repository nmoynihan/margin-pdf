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
import { ReaderStore } from './store'
import type { AppCommand } from '../shared/types'
import { zoomShortcut } from '../shared/shortcuts'

const here = dirname(fileURLToPath(import.meta.url))
const developmentURL = process.env.ELECTRON_RENDERER_URL
if (process.env.PDF_JUNKIE_USER_DATA)
  app.setPath('userData', resolve(process.env.PDF_JUNKIE_USER_DATA))
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
app.setName('PDF Junkie')

let window: BrowserWindow | null = null
let store: ReaderStore
let rendererReady = false
let closing = false
let quitting = false
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
  for (const path of paths.slice(0, 100)) {
    try {
      descriptors.push(await store.register(nativePath(path)))
    } catch (error) {
      window?.webContents.send(
        'open-error',
        `Could not open ${path.split(/[\\/]/).at(-1)}: ${(error as Error).message}`,
      )
    }
  }
  return descriptors
}

function deliverPaths(paths: string[]) {
  if (!rendererReady || !store) {
    pendingPaths.push(...paths)
    return
  }
  void openPaths(paths).then((files) => window?.webContents.send('files-opened', files))
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
  app.on('second-instance', (_event, argv) => deliverPaths(argv.filter(isPdfArgument)))
  void app.whenReady().then(async () => {
    store = new ReaderStore(join(app.getPath('userData'), 'reader-state.json'))
    await store.load()
    const assetRoot = resolve(here, '../renderer')
    protocol.handle('app', (request) => {
      try {
        const url = new URL(request.url)
        if (url.host !== 'reader') return new Response('Not found', { status: 404 })
        const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
        const file = resolve(assetRoot, `.${pathname}`)
        const relation = relative(assetRoot, file)
        if (relation.startsWith('..') || relation.includes('\0'))
          return new Response('Forbidden', { status: 403 })
        return net.fetch(pathToFileURL(file).toString())
      } catch {
        return new Response('Not found', { status: 404 })
      }
    })
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    )

    const handle = (name: string, callback: (...args: any[]) => unknown) => {
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
        return callback(...args)
      })
    }
    handle('bootstrap', async () => {
      const paths = pendingPaths
      pendingPaths = []
      const launchFiles = await openPaths(paths)
      rendererReady = true
      return {
        recent: await store.recent(),
        launchFiles,
        session: store.session,
        systemDark: nativeTheme.shouldUseDarkColors,
        platform: process.platform,
      }
    })
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
      const path = join(samples, 'Reading without losing the thread.pdf')
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
    handle('save-session', (snapshot: unknown) => store.saveSession(snapshot))
    handle('ready-to-close', async (snapshot: unknown) => {
      await store.saveSession(snapshot)
      closing = true
      if (quitting) app.quit()
      else window?.close()
    })
    handle('clear-recent', () => store.clearRecent())
    handle('open-external', async (value: unknown) => {
      if (typeof value !== 'string' || value.length > 8192) throw new Error('Invalid link')
      const url = new URL(value)
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol))
        throw new Error('This link type is not supported.')
      await shell.openExternal(url.toString())
    })
    handle(
      'print',
      () =>
        new Promise((resolvePrint) => {
          window!.webContents.print(
            { silent: false, printBackground: true },
            (success, failureReason) => resolvePrint({ success, reason: failureReason }),
          )
        }),
    )
    handle('toggle-fullscreen', () => window?.setFullScreen(!window.isFullScreen()))

    const command = (value: AppCommand) => () => window?.webContents.send('app-command', value)
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
            { label: 'Find in paper', accelerator: 'CmdOrCtrl+F', click: command('find') },
            { label: 'Zoom in', accelerator: 'CmdOrCtrl+Plus', click: command('zoom-in') },
            { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: command('zoom-out') },
            { label: 'Fit width', accelerator: 'CmdOrCtrl+0', click: command('fit-width') },
            { label: 'Rotate clockwise', accelerator: 'CmdOrCtrl+R', click: command('rotate') },
            { label: 'Split view', accelerator: 'CmdOrCtrl+\\', click: command('split') },
            { type: 'separator' },
            { role: 'togglefullscreen' },
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

    function createWindow() {
      rendererReady = false
      closing = false
      window = new BrowserWindow({
        width: 1380,
        height: 920,
        minWidth: 760,
        minHeight: 560,
        show: false,
        title: 'PDF Junkie',
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#171b22' : '#f4f5f7',
        autoHideMenuBar: process.platform !== 'darwin',
        icon: join(here, '../../resources/icon.png'),
        webPreferences: {
          preload: join(here, '../preload/index.cjs'),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          spellcheck: false,
        },
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
        window?.webContents.send('app-command', shortcut)
      })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      window.once('ready-to-show', () => window?.show())
      window.on('close', (event) => {
        if (!rendererReady || closing) return
        event.preventDefault()
        window?.webContents.send('prepare-close')
        setTimeout(() => {
          if (window && !closing) {
            closing = true
            if (quitting) app.quit()
            else window.close()
          }
        }, 3000).unref()
      })
      window.on('closed', () => {
        window = null
        rendererReady = false
      })
      if (developmentURL) void window.loadURL(developmentURL)
      else void window.loadURL('app://reader/index.html')
    }
    createWindow()
    nativeTheme.on('updated', () =>
      window?.webContents.send('system-theme', nativeTheme.shouldUseDarkColors),
    )
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
