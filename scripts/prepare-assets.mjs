import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

await import('./create-icons.mjs')
await import('./create-fixtures.mjs')

const destination = resolve('src/renderer/public/pdfjs')
await mkdir(destination, { recursive: true })
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(resolve('node_modules/pdfjs-dist', directory), resolve(destination, directory), {
    recursive: true,
  })
}
await cp('node_modules/pdfjs-dist/LICENSE', resolve(destination, 'LICENSE'))
await cp('node_modules/pdfjs-dist/web/images', resolve(destination, 'images'), { recursive: true })
