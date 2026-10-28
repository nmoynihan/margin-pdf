interface ZoomKey {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  isComposing?: boolean
}

export function zoomShortcut(input: ZoomKey, platform: string): 'zoom-in' | 'zoom-out' | null {
  if (
    input.isComposing ||
    input.altKey ||
    !(input.ctrlKey || (platform === 'darwin' && input.metaKey))
  )
    return null
  if (['+', '='].includes(input.key) || input.code === 'NumpadAdd') return 'zoom-in'
  if (input.key === '-' || input.code === 'NumpadSubtract') return 'zoom-out'
  return null
}
