import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ReaderStore } from '../../src/main/store'
import { emptySession } from '../../src/shared/types'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
describe('desktop document store', () => {
  it('reads only registered document handles and persists concurrent updates atomically', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pdf-junkie-store-'))
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
