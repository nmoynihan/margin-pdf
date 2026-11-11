import { chromeAPI } from './chrome'
import { readPreferences } from './storage'
import { shouldUsePdfTitle } from './title-rules'

export async function setPdfTabTitle(
  message: unknown,
  sender: { url?: string; tab?: { id?: number } },
): Promise<{ changed: boolean }> {
  if (!message || typeof message !== 'object') return { changed: false }
  const value = message as { title?: unknown; originalUrl?: unknown }
  if (
    sender.url?.split(/[?#]/)[0] !== chromeAPI.runtime.getURL('viewer.html') ||
    sender.tab?.id === undefined ||
    typeof value.originalUrl !== 'string' ||
    !(value.title === null || (typeof value.title === 'string' && value.title.length <= 1024))
  )
    return { changed: false }
  const url = new URL(value.originalUrl)
  if (!['http:', 'https:'].includes(url.protocol)) return { changed: false }
  const preferences = await readPreferences()
  if (
    value.title !== null &&
    !shouldUsePdfTitle(url.href, preferences.titleMode, preferences.titleDomains)
  )
    return { changed: false }
  if (!(await chromeAPI.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] })))
    return { changed: false }
  const result = await chromeAPI.scripting.executeScript({
    target: { tabId: sender.tab.id, frameIds: [0] },
    args: [value.title, value.originalUrl],
    func: (title, originalUrl) => {
      // Navigation may finish while the permission/settings checks are pending.
      if (location.href.split('#')[0] !== originalUrl.split('#')[0]) return false
      const state = globalThis as unknown as { __marginPdfTitle?: string }
      if (title === null) {
        if (state.__marginPdfTitle === undefined) return false
        document.title = state.__marginPdfTitle
        delete state.__marginPdfTitle
      } else {
        state.__marginPdfTitle ??= document.title
        document.title = title
      }
      return true
    },
  })
  return { changed: result.some((entry) => entry.result === true) }
}
