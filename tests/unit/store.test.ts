import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, open } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ReaderStore } from '../../src/main/store'
import { MAX_DOCUMENT_BYTES } from '../../src/shared/limits'
import { emptySession } from '../../src/shared/types'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
describe('desktop document store', () => {
  it('reads only registered document handles and persists concurrent updates atomically', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'margin-pdf-store-'))
    temporary.push(directory)
    const filename = join(directory, 'state.json'),
      paper = join(directory, 'paper.pdf')
    await writeFile(paper, '%PDF-test')
    const store = new ReaderStore(filename)
    await store.load()
    await expect(store.read('unknown')).rejects.toThrow('Unknown document')
    const handle = await store.register(paper)
    expect(Buffer.from(await store.read(handle.id)).toString()).toBe('%PDF-test')
    await Promise.all([
      store.saveSession({ ...emptySession(), theme: 'dark' }),
      store.saveSession({ ...emptySession(), theme: 'light' }),
    ])
    expect(JSON.parse(await readFile(filename, 'utf8')).session.theme).toBe('light')
    const restored = new ReaderStore(filename)
    await restored.load()
    expect((await restored.reopen(handle.id)).name).toBe('paper.pdf')
    expect(restored.session.theme).toBe('light')
    await rm(paper)
    await expect(restored.reopen(handle.id)).rejects.toThrow()
  })
})

it('clears against the current snapshot before a pending session save, revoking access and disk paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'margin-pdf-clear-'))
  temporary.push(directory)
  const filename = join(directory, 'reader-state.json')
  const paper = join(directory, 'private.pdf')
  await writeFile(paper, '%PDF-test')
  const store = new ReaderStore(filename)
  const descriptor = await store.register(paper)
  const tab = {
    documentId: descriptor.id,
    panes: [],
    activePaneId: 'main',
    orientation: 'horizontal',
    ratio: 0.5,
  }
  await store.saveSession({ ...emptySession(), tabs: [tab] })
  const snapshot = { ...emptySession(), rememberedTabs: [tab] }
  // Save an older snapshot first, then clear before the renderer debounce saves the empty tabs.
  const pending = store.saveSession({ ...emptySession(), tabs: [tab] })
  await store.clearRecent(snapshot)
  await pending
  await store.saveSession(snapshot)
  const saved = await readFile(filename, 'utf8')
  expect(saved).not.toContain(paper)
  expect(JSON.parse(saved).files).toEqual([])
  expect(JSON.parse(saved).session.rememberedTabs[0].documentId).toBe(descriptor.id)
  await expect(store.read(descriptor.id)).rejects.toThrow('Unknown document')
  await expect(store.reopen(descriptor.id)).rejects.toThrow('not in your recent')
  const restarted = new ReaderStore(filename)
  await restarted.load()
  await expect(restarted.read(descriptor.id)).rejects.toThrow('Unknown document')
})

it('retains access only while a cleared document is open and prunes it on close', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'margin-pdf-open-clear-'))
  temporary.push(directory)
  const filename = join(directory, 'state.json'),
    paper = join(directory, 'paper.pdf')
  await writeFile(paper, '%PDF-test')
  const store = new ReaderStore(filename)
  const { id } = await store.register(paper)
  await store.clearRecent({ ...emptySession(), tabs: [{ documentId: id }] })
  expect((await store.read(id)).length).toBeGreaterThan(0)
  expect(await store.recent()).toEqual([])
  await store.saveSession(emptySession())
  expect(await readFile(filename, 'utf8')).not.toContain(paper)
  await expect(store.read(id)).rejects.toThrow('Unknown document')
})

it('rejects sparse oversized input at registration and rechecks files that grew after registration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'margin-pdf-size-'))
  temporary.push(directory)
  const paper = join(directory, 'large.pdf')
  await writeFile(paper, '%PDF-test')
  const store = new ReaderStore(join(directory, 'state.json'))
  const { id } = await store.register(paper)
  const file = await open(paper, 'r+')
  await file.truncate(MAX_DOCUMENT_BYTES + 1)
  await file.close()
  await expect(store.read(id)).rejects.toThrow('128 MiB')
  await expect(store.register(paper)).rejects.toThrow('128 MiB')
})
