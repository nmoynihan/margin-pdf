import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const tag = process.env.GITHUB_REF_NAME
if (!tag?.startsWith('v') || process.env.GITHUB_REF_TYPE !== 'tag')
  throw new Error('Draft release creation requires a version-tag workflow.')
const assets = []
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collect(path)
    else if (/\.(AppImage|deb|pkg\.tar\.zst|exe|dmg|vsix|zip)$/.test(entry.name)) assets.push(path)
  }
}
await collect('release-artifacts')
if (!assets.length) throw new Error('No release packages were downloaded.')
const names = assets.map((path) => basename(path))
if (new Set(names).size !== names.length) throw new Error('Release artifact filenames collide.')
await mkdir('release-upload', { recursive: true })
const checksums = []
for (const path of assets.sort()) {
  const name = basename(path)
  await copyFile(path, join('release-upload', name))
  checksums.push(
    `${createHash('sha256')
      .update(await readFile(path))
      .digest('hex')}  ${name}`,
  )
}
await writeFile('release-upload/SHA256SUMS', checksums.join('\n') + '\n')
if (process.argv.includes('--dry-run')) {
  console.log(`Prepared ${assets.length} release packages and SHA256SUMS without uploading.`)
  process.exit(0)
}
const gh = (args) => execFileSync('gh', args, { stdio: 'inherit' })
gh([
  'release',
  'create',
  tag,
  '--draft',
  '--verify-tag',
  '--title',
  `Margin PDF ${tag}`,
  '--notes-file',
  'CHANGELOG.md',
])
gh([
  'release',
  'upload',
  tag,
  ...names.map((name) => join('release-upload', name)),
  'release-upload/SHA256SUMS',
])
