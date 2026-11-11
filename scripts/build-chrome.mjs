import { build } from 'esbuild'
import { build as viteBuild } from 'vite'
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'

await viteBuild({ configFile: 'vite.chrome.config.ts' })
await build({
  entryPoints: ['extensions/chrome/src/background.ts'],
  bundle: true,
  platform: 'browser',
  target: 'chrome151',
  format: 'esm',
  outfile: 'extensions/chrome/dist/background.js',
  sourcemap: false,
})
const destination = 'extensions/chrome/dist'
for (const file of ['manifest.json', 'privacy.html'])
  await cp(`extensions/chrome/${file}`, `${destination}/${file}`)
await cp('LICENSE', `${destination}/LICENSE`)
await cp('src/renderer/public/sample.pdf', `${destination}/sample.pdf`)
await mkdir(`${destination}/pdfjs`, { recursive: true })
for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs', 'images'])
  await cp(`src/renderer/public/pdfjs/${folder}`, `${destination}/pdfjs/${folder}`, {
    recursive: true,
  })
// PDF JavaScript scripting is not part of this reader. Do not ship its interpreter.
for (const file of ['quickjs-eval.js', 'quickjs-eval.wasm']) {
  const { rm } = await import('node:fs/promises')
  await rm(`${destination}/pdfjs/wasm/${file}`, { force: true })
}
await cp('node_modules/pdfjs-dist/LICENSE', `${destination}/pdfjs/LICENSE`)
await mkdir(`${destination}/icons`, { recursive: true })
const master = await loadImage('resources/branding/margin-pdf-icon-master.png')
for (const size of [16, 32, 48, 128]) {
  const canvas = createCanvas(size, size)
  const context = canvas.getContext('2d')
  context.imageSmoothingQuality = 'high'
  context.drawImage(master, 0, 0, size, size)
  await writeFile(`${destination}/icons/${size}.png`, canvas.toBuffer('image/png'))
}
const notices = []
for (const name of ['react', 'react-dom', 'scheduler', 'lucide-react', 'pdfjs-dist']) {
  const root = `node_modules/${name}`
  const files = await readdir(root)
  const license = files.find((file) => /^licen[cs]e(?:\.|$)/i.test(file))
  if (!license) throw new Error(`Missing license for bundled dependency ${name}`)
  notices.push(`${name}\n${await readFile(`${root}/${license}`, 'utf8')}`)
}
await writeFile(`${destination}/THIRD_PARTY_NOTICES.txt`, notices.join('\n\n----------------\n\n'))
console.log(`Chrome extension built in ${destination}`)
