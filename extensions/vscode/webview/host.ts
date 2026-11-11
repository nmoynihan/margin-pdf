import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw'
import type { HostMessage, WebviewMessage, WebviewRequests } from '../../../src/shared/vscode'
import type { ReaderHost } from '../../../src/shared/reader-host'

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewMessage): void
  setState(state: unknown): void
}
const vscode = acquireVsCodeApi()
let sequence = 0
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
const listeners = new Set<(message: HostMessage) => void>()
window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const message = event.data
  if (message.type === 'result') {
    const request = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) request?.reject(new Error(message.error))
    else request?.resolve(message.value)
  } else for (const listener of listeners) listener(message)
})

export function request<K extends keyof WebviewRequests>(
  method: K,
  args: WebviewRequests[K]['args'],
): Promise<WebviewRequests[K]['result']> {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('The VS Code host did not respond. Reopen this PDF to retry.'))
    }, 30_000)
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value as WebviewRequests[K]['result'])
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      },
    })
    vscode.postMessage({ type: 'request', id, method, args })
  })
}

export function subscribe(listener: (message: HostMessage) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const post = (message: WebviewMessage) => vscode.postMessage(message)
export const setState = (state: unknown) => vscode.setState(state)
const assets = document.querySelector<HTMLMetaElement>('meta[name="margin-assets"]')!.content

export const webviewHost: ReaderHost = {
  // VS Code's resource service worker associates requests with the webview frame.
  // Let PDF.js fetch auxiliary files there and send bytes to its PDF worker.
  useWorkerFetch: false,
  readDocument: async () => {
    const encoded = await request('read', undefined)
    const decoded = atob(encoded)
    const bytes = new Uint8Array(decoded.length)
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
    return bytes
  },
  assetUrl: (path) => `${assets}${path}`,
  createWorker: async () => {
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
    try {
      const port = new Worker(url, { type: 'module' })
      return {
        port,
        dispose: () => {
          port.terminate()
          URL.revokeObjectURL(url)
        },
      }
    } catch (error) {
      URL.revokeObjectURL(url)
      throw error
    }
  },
  openExternal: (url) => request('external', url),
  syncToSource: (_documentId, point) => request('reverse', point),
}
