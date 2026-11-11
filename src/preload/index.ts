import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopAPI, DesktopEvents, IpcRequests } from '../shared/types'

function subscribe<K extends keyof DesktopEvents>(
  channel: K,
  callback: (value: DesktopEvents[K]) => void,
) {
  const listener = (_event: Electron.IpcRendererEvent, value: DesktopEvents[K]) => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

function invoke<K extends keyof IpcRequests>(
  channel: K,
  ...args: IpcRequests[K]['args']
): Promise<IpcRequests[K]['result']> {
  return ipcRenderer.invoke(channel, ...args)
}

const api: DesktopAPI = {
  bootstrap: () => invoke('bootstrap'),
  rendererReady: () => invoke('renderer-ready'),
  restart: (safe) => invoke('restart', safe),
  setCompact: (compact) => invoke('set-compact', compact),
  onCompact: (callback) => subscribe('compact-mode', callback),
  chooseFiles: () => invoke('choose-files'),
  openSample: () => invoke('open-sample'),
  openDropped: (files) =>
    invoke('open-dropped', files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)),
  reopen: (id) => invoke('reopen', id),
  readDocument: (id) => invoke('read-document', id),
  watchDocuments: (documents) => invoke('watch-documents', documents),
  onDocumentChanged: (callback) => subscribe('document-changed', callback),
  saveSession: (snapshot) => invoke('save-session', snapshot),
  clearRecent: (snapshot) => invoke('clear-recent', snapshot),
  openExternal: (url) => invoke('open-external', url),
  print: () => invoke('print'),
  toggleFullscreen: () => invoke('toggle-fullscreen'),
  onFiles: (callback) => subscribe('files-opened', callback),
  onOpenError: (callback) => subscribe('open-error', callback),
  onCommand: (callback) => subscribe('app-command', callback),
  onSystemTheme: (callback) => subscribe('system-theme', callback),
  onBeforeClose: (callback) =>
    subscribe('prepare-close', () => {
      void invoke('ready-to-close', callback())
    }),
}
contextBridge.exposeInMainWorld('desktop', api)
