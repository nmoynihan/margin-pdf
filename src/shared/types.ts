export type Theme = 'system' | 'light' | 'dark'
export type Orientation = 'horizontal' | 'vertical'

export interface DocumentDescriptor {
  id: string
  name: string
  location: string
  size: number
  modified: number
}

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
  sidebar: 'outline' | 'thumbnails' | null
  rememberedTabs: TabSnapshot[]
}

export interface BootstrapState {
  recent: DocumentDescriptor[]
  launchFiles: DocumentDescriptor[]
  session: SessionSnapshot
  systemDark: boolean
  platform: string
}

export type AppCommand =
  | 'open'
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
  chooseFiles(): Promise<DocumentDescriptor[]>
  openSample(): Promise<DocumentDescriptor[]>
  openDropped(files: File[]): Promise<DocumentDescriptor[]>
  reopen(id: string): Promise<DocumentDescriptor>
  readDocument(id: string): Promise<Uint8Array>
  saveSession(session: SessionSnapshot): Promise<void>
  clearRecent(): Promise<void>
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
  sidebar: 'outline',
  rememberedTabs: [],
})
