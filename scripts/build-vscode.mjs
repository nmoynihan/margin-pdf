import { build } from 'esbuild'
import { build as viteBuild } from 'vite'
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'

await viteBuild({ configFile: 'vite.vscode.config.ts' })
await build({
  entryPoints: ['extensions/vscode/src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  outfile: 'extensions/vscode/dist/extension.cjs',
  sourcemap: false,
})
await mkdir('extensions/vscode/dist/media/pdfjs', { recursive: true })
for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs', 'images'])
  await cp(`src/renderer/public/pdfjs/${folder}`, `extensions/vscode/dist/media/pdfjs/${folder}`, {
    recursive: true,
  })
await cp('node_modules/pdfjs-dist/LICENSE', 'extensions/vscode/dist/media/pdfjs/LICENSE')
await cp('LICENSE', 'extensions/vscode/LICENSE')
await cp('resources/margin-pdf-icon.png', 'extensions/vscode/icon.png')
const notices = []
for (const name of [
  'react',
  'react-dom',
  'scheduler',
  'lucide-react',
  'pdf-lib',
  '@pdf-lib/standard-fonts',
  '@pdf-lib/upng',
  'pako',
  'pdf-lib/node_modules/tslib',
  'pdfjs-dist',
]) {
  const root = `node_modules/${name}`
  const files = await readdir(root)
  const license = files.find((file) => /^licen[cs]e(?:\.|$)/i.test(file))
  if (!license) throw new Error(`Missing license for bundled dependency ${name}`)
  notices.push(`${name}\n${await readFile(`${root}/${license}`, 'utf8')}`)
}
await writeFile(
  'extensions/vscode/dist/THIRD_PARTY_NOTICES.txt',
  notices.join('\n\n----------------\n\n'),
)
