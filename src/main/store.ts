import { readFile, writeFile, mkdir, rename, realpath } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { sanitizeSession } from '../shared/session'
import { emptySession, type DocumentDescriptor, type SessionSnapshot } from '../shared/types'
import { describePdf, readPdf } from '../shared/pdf-file'

interface FileRecord {
  id: string
  path: string
  lastOpened: number
}
interface SavedState {
  version: 1
  files: FileRecord[]
  session: SessionSnapshot
}

export class ReaderStore {
  private files = new Map<string, FileRecord>()
  private queue = Promise.resolve()
  session = emptySession()

  constructor(private readonly filename: string) {}

  async load() {
    try {
      const saved: SavedState = JSON.parse(await readFile(this.filename, 'utf8'))
      if (saved.version !== 1) return
      for (const file of (Array.isArray(saved.files) ? saved.files : []).slice(0, 200)) {
        if (file && typeof file.id === 'string' && typeof file.path === 'string')
          this.files.set(file.id, { ...file, lastOpened: Number(file.lastOpened) || 0 })
      }
      this.session = sanitizeSession(saved.session)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        console.warn('Could not restore reader state:', (error as Error).message)
    }
  }

  private async describe(record: FileRecord): Promise<DocumentDescriptor> {
    return describePdf(record.path, record.id)
  }

  async register(path: string) {
    const canonical = await realpath(path)
    if (extname(canonical).toLowerCase() !== '.pdf') throw new Error('Please choose a PDF file.')
    const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical
    const id = createHash('sha256').update(key).digest('hex').slice(0, 32)
    const record = { id, path: canonical, lastOpened: Date.now() }
    const descriptor = await this.describe(record)
    this.files.set(id, record)
    await this.persist()
    return descriptor
  }

  async reopen(id: string) {
    const record = this.files.get(id)
    if (!record)
      throw new Error('This file is not in your recent documents. Open it again from disk.')
    const descriptor = await this.describe(record)
    record.lastOpened = Date.now()
    await this.persist()
    return descriptor
  }

  async inspect(id: string) {
    const record = this.files.get(id)
    if (!record) throw new Error('This document is no longer registered.')
    return this.describe(record)
  }

  async read(id: string) {
    const record = this.files.get(id)
    if (!record) throw new Error('Unknown document. Open the PDF first.')
    const data = await readPdf(record.path)
    if (!this.files.has(id)) throw new Error('Document access was cleared.')
    return data
  }

  async recent() {
    const records = [...this.files.values()]
      .filter((f) => f.lastOpened > 0)
      .sort((a, b) => b.lastOpened - a.lastOpened)
      .slice(0, 30)
    const results = await Promise.allSettled(records.map((record) => this.describe(record)))
    return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  }

  async clearRecent(snapshot: unknown) {
    this.session = sanitizeSession(snapshot)
    const keep = new Set(this.session.tabs.map((tab) => tab.documentId))
    for (const [id, record] of this.files) {
      if (keep.has(id)) record.lastOpened = 0
      else this.files.delete(id)
    }
    await this.persist()
  }

  async saveSession(session: unknown) {
    this.session = sanitizeSession(session)
    await this.persist()
  }

  persist() {
    const active = new Set(this.session.tabs.map((tab) => tab.documentId))
    const sorted = [...this.files.values()].sort((a, b) => b.lastOpened - a.lastOpened)
    const keep = sorted.filter(
      (file, index) => (file.lastOpened > 0 && index < 100) || active.has(file.id),
    )
    const retained = new Set(keep.map((file) => file.id))
    for (const id of this.files.keys()) if (!retained.has(id)) this.files.delete(id)
    const contents = JSON.stringify({
      version: 1,
      files: keep,
      session: this.session,
    } satisfies SavedState)
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.filename), { recursive: true })
        const temporary = join(dirname(this.filename), 'reader-state.tmp')
        await writeFile(temporary, contents, { mode: 0o600 })
        await rename(temporary, this.filename)
      })
    return this.queue
  }
}
