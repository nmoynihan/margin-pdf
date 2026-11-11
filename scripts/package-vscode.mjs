import { createVSIX } from '@vscode/vsce'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const manifest = JSON.parse(await readFile('extensions/vscode/package.json', 'utf8'))
await mkdir('dist', { recursive: true })
await createVSIX({
  cwd: resolve('extensions/vscode'),
  packagePath: resolve(`dist/${manifest.name}-${manifest.version}.vsix`),
  dependencies: false,
  allowMissingRepository: true,
})
