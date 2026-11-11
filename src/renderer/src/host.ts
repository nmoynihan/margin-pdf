import type { ReaderHost } from '../../shared/reader-host'

let host: ReaderHost

export function configureReaderHost(value: ReaderHost) {
  host = value
}

export function readerHost(): ReaderHost {
  if (!host) throw new Error('The reader host has not been initialized.')
  return host
}
