import { chromeAPI } from './chrome'

// Browser accelerators can bypass the viewer's DOM key handler. Manual, per-tab
// zoom keeps the UI at 100% and lets us apply Chrome's zoom changes to the PDF.
export async function bindPdfZoom(
  native: boolean,
  signal: AbortSignal,
  zoomBy: (factor: number) => void,
): Promise<void> {
  const stream = native ? await chromeAPI.mimeHandler!.getStreamInfo() : undefined
  // An embedded PDF must not take over zoom for the surrounding web page.
  if (stream?.embedded || signal.aborted) return
  const tabId = stream?.tabId ?? (await chromeAPI.tabs.getCurrent())?.id
  if (tabId === undefined || signal.aborted) return
  const { mode, scope } = await chromeAPI.tabs.getZoomSettings(tabId)
  const previous = { mode, scope }
  if (signal.aborted) return
  let leaving = false
  const leave = () => {
    leaving = true
  }
  const changed: Parameters<typeof chromeAPI.tabs.onZoomChange.addListener>[0] = (event) => {
    if (signal.aborted || event.tabId !== tabId || event.zoomSettings.mode !== 'manual') return
    const factor = event.newZoomFactor / event.oldZoomFactor
    if (Number.isFinite(factor) && factor > 0 && factor !== 1) zoomBy(factor)
  }
  const dispose = () => {
    chromeAPI.tabs.onZoomChange.removeListener(changed)
    window.removeEventListener('pagehide', leave)
    // Chrome resets per-tab zoom settings on navigation. Never change the next
    // page's settings from a departing viewer.
    if (!leaving) void chromeAPI.tabs.setZoomSettings(tabId, previous).catch(() => {})
  }
  window.addEventListener('pagehide', leave, { once: true })
  try {
    await chromeAPI.tabs.setZoomSettings(tabId, { mode: 'manual', scope: 'per-tab' })
  } catch (reason) {
    window.removeEventListener('pagehide', leave)
    throw reason
  }
  if (signal.aborted) {
    dispose()
    return
  }
  chromeAPI.tabs.onZoomChange.addListener(changed)
  signal.addEventListener('abort', dispose, { once: true })
}
