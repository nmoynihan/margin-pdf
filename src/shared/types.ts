export type Theme = 'system' | 'light' | 'dark'
export const skinIds = ['classic', 'folio', 'studio', 'terminal', 'focus'] as const
export type Skin = (typeof skinIds)[number]
export type Orientation = 'horizontal' | 'vertical'

export interface WorkspaceLayout {
  controls: 'top' | 'left' | 'bottom'
  tabs: 'top' | 'bottom' | 'left' | 'right'
  sidebar: 'left' | 'right' | 'overlay'
  documentTools: 'top' | 'bottom'
  pageControls: 'top' | 'bottom'
}

export const defaultLayout = (): WorkspaceLayout => ({
  controls: 'top',
  tabs: 'top',
  sidebar: 'left',
  documentTools: 'top',
  pageControls: 'top',
})

export interface DocumentDescriptor {
  id: string
  name: string
  location: string
  size: number
  modified: number
  revision?: string
}

export interface DocumentChange {
  id: string
  descriptor?: DocumentDescriptor
  error?: string
}

export type WatchedDocument = Pick<DocumentDescriptor, 'id' | 'revision'>

export interface ReadingPosition {
  page: number
  left: number
  top: number
  zoom: string
  rotation: number
}

export interface PaneSnapshot {
  id: string
  position: ReadingPosition
}

export interface TabSnapshot {
  documentId: string
  panes: PaneSnapshot[]
  activePaneId: string
  orientation: Orientation
  ratio: number
}

export interface SessionSnapshot {
  version: 1
  tabs: TabSnapshot[]
  activeDocumentId: string | null
  theme: Theme
  skin: Skin
  layout: WorkspaceLayout
  sidebar: 'outline' | 'thumbnails' | null
  rememberedTabs: TabSnapshot[]
}

export interface BootstrapState {
  recent: DocumentDescriptor[]
  launchFiles: DocumentDescriptor[]
  session: SessionSnapshot
  systemDark: boolean
  platform: string
  safeMode: boolean
  compact: boolean
}

export interface IpcRequests {
  bootstrap: { args: []; result: BootstrapState }
  'renderer-ready': { args: []; result: void }
  'choose-files': { args: []; result: DocumentDescriptor[] }
  'open-sample': { args: []; result: DocumentDescriptor[] }
  'open-dropped': { args: [paths: string[]]; result: DocumentDescriptor[] }
  reopen: { args: [id: string]; result: DocumentDescriptor }
  'read-document': { args: [id: string]; result: Uint8Array }
  'watch-documents': { args: [documents: WatchedDocument[]]; result: void }
  'save-session': { args: [snapshot: SessionSnapshot]; result: void }
  'ready-to-close': { args: [snapshot: SessionSnapshot]; result: void }
  'clear-recent': { args: [snapshot: SessionSnapshot]; result: void }
  'open-external': { args: [url: string]; result: void }
  print: { args: []; result: { success: boolean; reason?: string } }
  'toggle-fullscreen': { args: []; result: void }
  restart: { args: [safe: boolean]; result: void }
  'set-compact': { args: [compact: boolean]; result: void }
}

export interface DesktopEvents {
  'files-opened': DocumentDescriptor[]
  'document-changed': DocumentChange
  'open-error': string
  'app-command': AppCommand
  'system-theme': boolean
  'prepare-close': undefined
  'compact-mode': boolean
}

export type AppCommand =
  | 'open'
  | 'options'
  | 'close-tab'
  | 'find'
  | 'print'
  | 'zoom-in'
  | 'zoom-out'
  | 'fit-width'
  | 'rotate'
  | 'split'
  | 'next-tab'
  | 'previous-tab'
  | 'back'
  | 'forward'

export interface DesktopAPI {
  bootstrap(): Promise<BootstrapState>
  rendererReady(): Promise<void>
  restart(safe: boolean): Promise<void>
  setCompact(compact: boolean): Promise<void>
  onCompact(callback: (compact: boolean) => void): () => void
  chooseFiles(): Promise<DocumentDescriptor[]>
  openSample(): Promise<DocumentDescriptor[]>
  openDropped(files: File[]): Promise<DocumentDescriptor[]>
  reopen(id: string): Promise<DocumentDescriptor>
  readDocument(id: string): Promise<Uint8Array>
  watchDocuments(documents: WatchedDocument[]): Promise<void>
  onDocumentChanged(callback: (change: DocumentChange) => void): () => void
  saveSession(session: SessionSnapshot): Promise<void>
  clearRecent(session: SessionSnapshot): Promise<void>
  openExternal(url: string): Promise<void>
  print(): Promise<{ success: boolean; reason?: string }>
  toggleFullscreen(): Promise<void>
  onFiles(callback: (documents: DocumentDescriptor[]) => void): () => void
  onOpenError(callback: (message: string) => void): () => void
  onCommand(callback: (command: AppCommand) => void): () => void
  onSystemTheme(callback: (dark: boolean) => void): () => void
  onBeforeClose(callback: () => SessionSnapshot): () => void
}

export const initialPosition = (): ReadingPosition => ({
  page: 1,
  left: 0,
  top: 0,
  zoom: 'page-width',
  rotation: 0,
})
export const emptySession = (): SessionSnapshot => ({
  version: 1,
  tabs: [],
  activeDocumentId: null,
  theme: 'system',
  skin: 'classic',
  layout: defaultLayout(),
  sidebar: 'outline',
  rememberedTabs: [],
})
