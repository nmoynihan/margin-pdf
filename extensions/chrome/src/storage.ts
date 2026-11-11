import { sanitizeSession } from '../../../src/shared/session'
import type { Skin, TabSnapshot, Theme } from '../../../src/shared/types'
import { chromeAPI } from './chrome'
import { normalizeTitleDomains, type TitleMode } from './title-rules'

export interface Preferences {
  theme: Theme
  skin: Skin
  remember: boolean
  titleMode: TitleMode
  titleDomains: string[]
}
export const defaultPreferences: Preferences = {
  theme: 'system',
  skin: 'classic',
  remember: false,
  titleMode: 'website',
  titleDomains: ['arxiv.org'],
}

export async function readPreferences(): Promise<Preferences> {
  const { preferences } = await chromeAPI.storage.local.get('preferences')
  const value = (preferences ?? {}) as Partial<Preferences>
  const clean = sanitizeSession({ version: 1, ...value })
  let titleDomains = defaultPreferences.titleDomains
  try {
    if (Array.isArray(value.titleDomains))
      titleDomains = normalizeTitleDomains(
        value.titleDomains.filter((entry) => typeof entry === 'string').join('\n'),
      )
  } catch {
    /* Ignore invalid stored domain rules. */
  }
  return {
    theme: clean.theme,
    skin: clean.skin,
    remember: value.remember === true,
    titleMode:
      value.titleMode === 'all' || value.titleMode === 'domains' ? value.titleMode : 'website',
    titleDomains,
  }
}

export async function readPosition(id: string): Promise<TabSnapshot | undefined> {
  const key = `position:${id}`
  const values = await chromeAPI.storage.local.get(key)
  const entry = values[key] as { snapshot?: unknown } | undefined
  const snapshot = sanitizeSession({ version: 1, tabs: [entry?.snapshot] }).tabs[0]
  return snapshot?.documentId === id ? snapshot : undefined
}

// Serialize writes and deletion so disabling history cannot race a pending position write.
let writes = Promise.resolve()
export function savePosition(snapshot: TabSnapshot): Promise<void> {
  writes = writes
    .catch(() => {})
    .then(async () => {
      if (!(await readPreferences()).remember) return
      await chromeAPI.storage.local.set({
        [`position:${snapshot.documentId}`]: { snapshot, updated: Date.now() },
      })
      // Another reader tab may have disabled history during this asynchronous write.
      if (!(await readPreferences()).remember) {
        await chromeAPI.storage.local.remove(`position:${snapshot.documentId}`)
        return
      }
      const all = await chromeAPI.storage.local.get(null)
      const old = Object.entries(all)
        .filter(([key]) => key.startsWith('position:'))
        .sort(
          (a, b) =>
            Number((b[1] as { updated: number }).updated) -
            Number((a[1] as { updated: number }).updated),
        )
        .slice(100)
        .map(([key]) => key)
      if (old.length) await chromeAPI.storage.local.remove(old)
    })
  return writes
}

export function forgetPositions(): Promise<void> {
  writes = writes
    .catch(() => {})
    .then(async () => {
      const all = await chromeAPI.storage.local.get(null)
      const keys = Object.keys(all).filter((key) => key.startsWith('position:'))
      if (keys.length) await chromeAPI.storage.local.remove(keys)
    })
  return writes
}
