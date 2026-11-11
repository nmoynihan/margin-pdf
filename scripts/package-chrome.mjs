import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { ZipFile } from 'yazl'

const directory = resolve('extensions/chrome/dist')
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'))
const zip = new ZipFile()
async function add(directoryName) {
  for (const file of (await readdir(directoryName, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = resolve(directoryName, file.name)
    if (file.isDirectory()) await add(path)
    else
      zip.addFile(path, relative(directory, path).replaceAll('\\', '/'), {
        mtime: new Date('2026-01-01T00:00:00Z'),
      })
  }
}
await add(directory)
await mkdir('dist', { recursive: true })
const output = `dist/margin-pdf-chrome-${manifest.version}.zip`
const writing = pipeline(zip.outputStream, createWriteStream(output))
zip.end()
await writing
console.log(`Chrome Web Store upload package: ${output}`)
