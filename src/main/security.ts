import type { IpcRequests } from '../shared/types'

export const productionCSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' blob:; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"

export function validateArguments(channel: keyof IpcRequests, args: unknown[]) {
  const oneArgument = [
    'open-dropped',
    'reopen',
    'read-document',
    'watch-documents',
    'save-session',
    'ready-to-close',
    'clear-recent',
    'open-external',
    'restart',
    'set-compact',
  ].includes(channel)
  if (args.length !== (oneArgument ? 1 : 0)) throw new Error('Invalid request arguments')
  const value = args[0]
  if (channel === 'watch-documents') {
    if (
      !Array.isArray(value) ||
      value.length > 100 ||
      value.some(
        (item) =>
          !item ||
          typeof item.id !== 'string' ||
          !/^[a-f0-9]{32}$/.test(item.id) ||
          (item.revision !== undefined &&
            (typeof item.revision !== 'string' || item.revision.length > 256)),
      )
    )
      throw new Error('Invalid watched documents')
  }
  if (channel === 'reopen' || channel === 'read-document') {
    if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value))
      throw new Error('Invalid document handle')
  }
  if (channel === 'restart' && typeof value !== 'boolean') throw new Error('Invalid restart')
  if (channel === 'set-compact' && typeof value !== 'boolean')
    throw new Error('Invalid compact mode')
  if (
    channel === 'open-dropped' &&
    (!Array.isArray(value) || value.some((path) => typeof path !== 'string' || path.length > 32768))
  )
    throw new Error('Invalid file selection')
  if (channel === 'open-external' && (typeof value !== 'string' || value.length > 8192))
    throw new Error('Invalid link')
  // Session structures are normalized by sanitizeSession at the storage boundary.
}
