// Small, explicit surface shared by the viewer and the extension service worker.
// mimeHandler is available from Chrome 151, the extension's minimum version.
export interface StreamInfo {
  originalUrl: string
  streamUrl: string
  embedded: boolean
  responseHeaders: Record<string, string>
}

interface ChromeAPI {
  runtime: { getURL(path: string): string }
  action: { onClicked: { addListener(callback: () => void): void } }
  tabs: { create(options: { url: string }): Promise<unknown> }
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
