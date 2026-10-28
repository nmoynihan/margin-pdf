import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopAPI } from '../shared/types'

function subscribe<T>(channel: string, callback: (value: T) => void) {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DesktopAPI = {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  chooseFiles: () => ipcRenderer.invoke('choose-files'),
  openSample: () => ipcRenderer.invoke('open-sample'),
  openDropped: (files) =>
    ipcRenderer.invoke(
      'open-dropped',
      files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
    ),
  reopen: (id) => ipcRenderer.invoke('reopen', id),
  readDocument: (id) => ipcRenderer.invoke('read-document', id),
  saveSession: (snapshot) => ipcRenderer.invoke('save-session', snapshot),
  clearRecent: () => ipcRenderer.invoke('clear-recent'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  print: () => ipcRenderer.invoke('print'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  onFiles: (callback) => subscribe('files-opened', callback),
  onOpenError: (callback) => subscribe('open-error', callback),
  onCommand: (callback) => subscribe('app-command', callback),
  onSystemTheme: (callback) => subscribe('system-theme', callback),
  onBeforeClose: (callback) =>
    subscribe('prepare-close', () => {
      void ipcRenderer.invoke('ready-to-close', callback())
    }),
}
contextBridge.exposeInMainWorld('desktop', api)
