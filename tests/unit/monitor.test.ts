import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReaderStore } from '../../src/main/store'
import { DocumentMonitor } from '../../src/main/DocumentMonitor'
import type { DocumentChange } from '../../src/shared/types'

let directory: string
let monitor: DocumentMonitor
afterEach(async () => {
  monitor?.stop()
  if (directory) await rm(directory, { recursive: true, force: true })
})

it('waits for stable writes, follows atomic replacements and recovers from a missing file', async () => {
  directory = await mkdtemp(join(tmpdir(), 'margin-monitor-'))
  const paper = join(directory, 'paper.pdf')
  await writeFile(paper, '%PDF-original')
  const store = new ReaderStore(join(directory, 'state.json'))
  const descriptor = await store.register(paper)
  const changes: DocumentChange[] = []
  monitor = new DocumentMonitor(
    (id) => store.inspect(id),
    (change) => changes.push(change),
  )
  monitor.setDocuments([descriptor])
  await monitor.poll()
  expect(changes).toEqual([])
  await writeFile(paper, '%PDF-in-progress')
  await monitor.poll()
  await writeFile(paper, '%PDF-finished-version')
  await monitor.poll()
  expect(changes).toHaveLength(0)
  await monitor.poll()
  expect(changes).toHaveLength(1)
  const replacement = join(directory, 'replacement.pdf')
  await writeFile(replacement, '%PDF-atomic-replacement')
  await rename(replacement, paper)
  await monitor.poll()
  await monitor.poll()
  expect(changes).toHaveLength(2)
  expect(changes[1].descriptor?.id).toBe(descriptor.id)
  expect(changes[1].descriptor?.revision).not.toBe(changes[0].descriptor?.revision)
  await rm(paper)
  await monitor.poll()
  await monitor.poll()
  expect(changes[2].error).toContain('temporarily unavailable')
  await writeFile(paper, '%PDF-returned')
  await monitor.poll()
  await monitor.poll()
  expect(changes[3].descriptor?.id).toBe(descriptor.id)
  expect(changes[3].error).toBeUndefined()
  monitor.setDocuments([])
  await writeFile(paper, '%PDF-after-close')
  await monitor.poll()
  await monitor.poll()
  expect(changes).toHaveLength(4)
})

it('ignores a pending inspection when a tab closes', async () => {
  const descriptor = { id: 'a', name: 'a.pdf', location: '', size: 1, modified: 0, revision: 'new' }
  let finish!: (value: typeof descriptor) => void
  const changes: DocumentChange[] = []
  monitor = new DocumentMonitor(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    (change) => changes.push(change),
  )
  monitor.setDocuments([{ id: 'a', revision: 'old' }])
  const polling = monitor.poll()
  monitor.setDocuments([])
  finish(descriptor)
  await polling
  expect(changes).toEqual([])
})
