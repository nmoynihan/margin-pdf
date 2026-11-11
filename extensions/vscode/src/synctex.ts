import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PdfPoint, SyncTarget } from '../../../src/shared/reader-host'

const execute = promisify(execFile)

export function records(output: string): Array<Record<string, string>> {
  const result: Array<Record<string, string>> = []
  let record: Record<string, string> | undefined
  let inside = false
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === 'SyncTeX result begin') {
      inside = true
      continue
    }
    if (line.trim() === 'SyncTeX result end') break
    if (!inside) continue
    const match = /^([A-Za-z]+):(.*)$/.exec(line)
    if (!match) continue
    if (!record || match[1] === 'Output') {
      record = {}
      result.push(record)
    }
    record[match[1]] = match[2].trim()
  }
  return result
}

export function parseForward(output: string): Omit<SyncTarget, 'requestId'> {
  const record = records(output).find(
    (r) => Number(r.Page) > 0 && Number.isFinite(Number(r.x)) && Number.isFinite(Number(r.y)),
  )
  if (!record)
    throw new Error(
      'No matching PDF location. Rebuild with -synctex=1, or associate this source with the correct PDF.',
    )
  const height = Math.abs(Number(record.H) || 10)
  const width = Math.abs(Number(record.W) || 12)
  return {
    page: Number(record.Page),
    x: Number.isFinite(Number(record.h)) ? Number(record.h) : Number(record.x),
    y: Number.isFinite(Number(record.v)) ? Number(record.v) - height : Number(record.y),
    width,
    height,
  }
}

export function parseReverse(output: string) {
  const record = records(output).find((r) => r.Input && Number(r.Line) > 0)
  if (!record) throw new Error('No matching source location. Rebuild the project with -synctex=1.')
  return {
    input: record.Input,
    line: Number(record.Line),
    column: Math.max(0, Number(record.Column) || 0),
  }
}

export interface SyncOptions {
  executable: string
  cwd: string
  directory?: string
}

async function run(options: SyncOptions, args: string[]) {
  try {
    const { stdout } = await execute(
      options.executable,
      [...args, ...(options.directory ? ['-d', options.directory] : [])],
      {
        cwd: options.cwd,
        timeout: 10_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        // The CLI otherwise executes these environment-provided commands implicitly.
        env: { ...process.env, SYNCTEX_EDITOR: '', SYNCTEX_VIEWER: '' },
      },
    )
    return stdout
  } catch (reason) {
    const error = reason as NodeJS.ErrnoException & { killed?: boolean }
    if (error.code === 'ENOENT')
      throw new Error(
        'SyncTeX was not found. Install a TeX distribution or set marginPdf.synctexPath.',
      )
    throw new Error(
      error.killed
        ? 'SyncTeX timed out. Try again after the build finishes.'
        : 'SyncTeX could not read the mapping. Rebuild with -synctex=1 and check marginPdf.synctexDirectory.',
    )
  }
}

export async function forward(
  options: SyncOptions,
  pdf: string,
  source: string,
  line: number,
  column: number,
) {
  return parseForward(await run(options, ['view', '-i', `${line}:${column}:${source}`, '-o', pdf]))
}

export async function reverse(options: SyncOptions, pdf: string, point: PdfPoint) {
  return parseReverse(
    await run(options, ['edit', '-o', `${point.page}:${point.x}:${point.y}:${pdf}`]),
  )
}
