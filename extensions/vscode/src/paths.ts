import { access, readFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'

export const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

export async function sourceRoot(source: string) {
  const seen = new Set<string>()
  for (let i = 0; i < 16; i++) {
    if (seen.has(source)) throw new Error('The TeX root directives contain a cycle.')
    seen.add(source)
    const contents = await readFile(source, 'utf8')
    const directive = /^\s*%\s*!\s*tex\s+root\s*=\s*(.+?)\s*$/im.exec(contents)
    if (!directive) return source
    source = resolve(dirname(source), directive[1].replace(/^['"]|['"]$/g, ''))
  }
  throw new Error('Too many nested TeX root directives.')
}

export function conventionalPdf(root: string, outDir: string) {
  const stem = basename(root, extname(root))
  const expanded = outDir
    .replaceAll('%DIR%', dirname(root))
    .replaceAll('%DOCFILE%', stem)
    .replaceAll('%DOC%', root.slice(0, -extname(root).length))
  if (/%[A-Z]+%/.test(expanded)) return undefined
  return resolve(dirname(root), expanded, `${stem}.pdf`)
}

export async function resolveInput(input: string, cwd: string, pdf: string, workspaces: string[]) {
  if (isAbsolute(input)) {
    if (await exists(input)) return resolve(input)
  } else {
    const candidates = [resolve(cwd, input)]
    let directory = dirname(pdf)
    for (let i = 0; i < 10; i++) {
      candidates.push(resolve(directory, input))
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    candidates.push(...workspaces.map((folder) => resolve(folder, input)))
    for (const path of new Set(candidates)) if (await exists(path)) return path
  }
  throw new Error(`The source file reported by SyncTeX is unavailable: ${input}`)
}
