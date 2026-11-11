import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const archive = process.argv[2] ?? join('dist', `margin-pdf-${version}-1-x86_64.pkg.tar.zst`)
const extract = (path) => execFileSync('bsdtar', ['-xOf', archive, path])
const metadata = extract('.PKGINFO').toString()
for (const line of metadata.split('\n').filter((line) => line && !line.startsWith('#')))
  assert.match(line, /^[a-z][a-z0-9_]* = .+$/, 'PKGINFO fields must occupy one line')
assert.match(metadata, /^pkgname = margin-pdf$/m)
assert.match(metadata, /^arch = x86_64$/m)
assert.ok(metadata.includes(`pkgver = ${version}-1\n`), 'Package must match the current version')
for (const dependency of ['alsa-lib', 'gtk3', 'mesa', 'nss', 'libcups', 'xdg-utils'])
  assert.ok(metadata.includes(`depend = ${dependency}\n`), `Missing dependency ${dependency}`)
const desktop = extract('usr/share/applications/margin-pdf.desktop').toString()
assert.match(desktop, /^Name=Margin PDF$/m)
assert.match(desktop, /^Exec="\/opt\/Margin PDF\/margin-pdf" %U$/m)
assert.match(desktop, /^Icon=margin-pdf$/m)
assert.match(desktop, /^StartupWMClass=margin-pdf$/m)
assert.match(desktop, /^MimeType=application\/pdf;$/m)
assert.doesNotMatch(desktop, /--no-sandbox/)
const icon = extract('usr/share/icons/hicolor/512x512/apps/margin-pdf.png')
assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
assert.equal(icon.readUInt32BE(16), 512)
assert.equal(icon.readUInt32BE(20), 512)
const files = execFileSync('bsdtar', ['-tf', archive], { encoding: 'utf8' })
assert.ok(files.split('\n').includes('opt/Margin PDF/margin-pdf'))
assert.ok(files.split('\n').includes('opt/Margin PDF/resources/app.asar'))
console.log(
  'Arch package metadata, launcher, PDF association, icon and application payload checks passed.',
)
