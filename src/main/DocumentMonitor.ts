import type { DocumentChange, DocumentDescriptor, WatchedDocument } from '../shared/types'

interface Entry {
  reported: string | undefined
  candidate?: string
  stable: number
}

// Poll paths rather than inodes: compilers commonly replace PDFs with an atomic rename.
// Only open tabs are polled. No file descriptor remains open between checks.
export class DocumentMonitor {
  private entries = new Map<string, Entry>()
  private timer: ReturnType<typeof setInterval> | undefined
  private polling = false

  constructor(
    private inspect: (id: string) => Promise<DocumentDescriptor>,
    private changed: (change: DocumentChange) => void,
  ) {}

  setDocuments(documents: WatchedDocument[]) {
    const keep = new Set(documents.map((document) => document.id))
    for (const id of this.entries.keys()) if (!keep.has(id)) this.entries.delete(id)
    for (const document of documents)
      if (!this.entries.has(document.id))
        this.entries.set(document.id, { reported: document.revision, stable: 0 })
    if (this.entries.size && !this.timer) {
      this.timer = setInterval(() => void this.poll(), 700)
      this.timer.unref()
    } else if (!this.entries.size) this.stop()
  }

  async poll() {
    if (this.polling) return
    this.polling = true
    try {
      await Promise.all(
        [...this.entries].map(async ([id, entry]) => {
          let descriptor: DocumentDescriptor | undefined
          let error: string | undefined
          try {
            descriptor = await this.inspect(id)
          } catch (reason) {
            error =
              (reason as NodeJS.ErrnoException).code === 'ENOENT'
                ? 'The PDF is temporarily unavailable. Waiting for it to return.'
                : `Cannot read the updated PDF: ${(reason as Error).message}`
          }
          if (this.entries.get(id) !== entry) return
          const signature = descriptor?.revision ?? `error:${error}`
          if (signature === entry.reported) {
            entry.stable = 0
            return
          }
          if (signature !== entry.candidate) {
            entry.candidate = signature
            entry.stable = 1
            return
          }
          if (++entry.stable < 2) return
          entry.reported = signature
          entry.stable = 0
          this.changed({ id, descriptor, error })
        }),
      )
    } finally {
      this.polling = false
    }
  }

  stop() {
    clearInterval(this.timer)
    this.timer = undefined
    this.entries.clear()
  }
}
