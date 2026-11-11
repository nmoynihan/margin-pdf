import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const readJSON = async (path) => JSON.parse(await readFile(path, 'utf8'))
const root = await readJSON('package.json')
const chrome = await readJSON('extensions/chrome/manifest.json')
const vscode = await readJSON('extensions/vscode/package.json')
const lock = await readJSON('package-lock.json')
assert.match(root.version, /^\d+\.\d+\.\d+$/, 'Release versions must be numeric major.minor.patch')
for (const [name, version] of Object.entries({
  Chrome: chrome.version,
  'VS Code': vscode.version,
  lockfile: lock.version,
  'lockfile root': lock.packages[''].version,
}))
  assert.equal(version, root.version, `${name} version differs from the root package`)
const repo = 'https://github.com/nmoynihan/margin-pdf'
assert.equal(root.homepage, repo)
assert.equal(chrome.homepage_url, repo)
assert.equal(vscode.repository.url, `git+${repo}.git`)
for (const path of ['CHANGELOG.md', 'extensions/vscode/CHANGELOG.md']) {
  const changelog = await readFile(path, 'utf8')
  assert.ok(changelog.includes(`## ${root.version} `), `${path} needs a release entry`)
}
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : process.argv[2]
if (tag) assert.equal(tag, `v${root.version}`, 'Release tag must match the package versions')
console.log(`Release metadata verified for v${root.version}.`)
