// Small, explicit surface shared by the viewer and the extension service worker.
// mimeHandler is available from Chrome 151, the extension's minimum version.
export interface StreamInfo {
  tabId: number
  originalUrl: string
  streamUrl: string
  embedded: boolean
  responseHeaders: Record<string, string>
}

interface ZoomSettings {
  mode: 'automatic' | 'manual' | 'disabled'
  scope: 'per-origin' | 'per-tab'
}

interface ZoomChange {
  tabId: number
  oldZoomFactor: number
  newZoomFactor: number
  zoomSettings: ZoomSettings
}

interface ChromeAPI {
  runtime: { getURL(path: string): string }
  action: { onClicked: { addListener(callback: () => void): void } }
  tabs: {
    create(options: { url: string }): Promise<unknown>
    getCurrent(): Promise<{ id?: number } | undefined>
    getZoomSettings(tabId: number): Promise<ZoomSettings>
    setZoomSettings(tabId: number, settings: ZoomSettings): Promise<void>
    onZoomChange: {
      addListener(callback: (change: ZoomChange) => void): void
      removeListener(callback: (change: ZoomChange) => void): void
    }
  }
  storage: {
    local: {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>
      set(values: Record<string, unknown>): Promise<void>
      remove(keys: string | string[]): Promise<void>
    }
  }
  mimeHandler?: {
    getStreamInfo(): Promise<StreamInfo>
    abortAndFallbackToNativeHandler(): Promise<void>
    getMimeHandlerOptions(type: string): Promise<{ enabled?: boolean }>
    setMimeHandlerOptions(type: string, options: { enabled: boolean }): Promise<void>
  }
}

export const chromeAPI = (globalThis as unknown as { chrome: ChromeAPI }).chrome
