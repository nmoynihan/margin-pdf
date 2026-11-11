import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DOMMatrix } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'
import {
  forward,
  parseForward,
  parseReverse,
  records,
  reverse,
} from '../../extensions/vscode/src/synctex'
import { conventionalPdf, resolveInput, sourceRoot } from '../../extensions/vscode/src/paths'
import { pagePointFromClient, viewportRectFromTarget } from '../../src/renderer/src/pdf/synctex'

let directory: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'margin latex '))
})
afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

it('parses SyncTeX records without corrupting Windows drive letters or file spaces', () => {
  const output =
    'diagnostic\nSyncTeX result begin\nOutput:C:\\papers\\a b.pdf\nInput:C:\\papers\\chapter.tex\nLine:12\nColumn:-1\nSyncTeX result end\n'
  expect(records(output)).toHaveLength(1)
  expect(parseReverse(output)).toEqual({ input: 'C:\\papers\\chapter.tex', line: 12, column: 0 })
  expect(() => parseForward(output)).toThrow('No matching PDF')
})

it('resolves root directives and conventional output directories, and detects cycles', async () => {
  await writeFile(join(directory, 'part.tex'), '% !TeX root = "root.tex"\n')
  await writeFile(join(directory, 'root.tex'), '\\documentclass{article}\n')
  expect(await sourceRoot(join(directory, 'part.tex'))).toBe(join(directory, 'root.tex'))
  expect(conventionalPdf(join(directory, 'root.tex'), '%DIR%/build')).toBe(
    join(directory, 'build', 'root.pdf'),
  )
  expect(conventionalPdf(join(directory, 'root.tex'), '%TMPDIR%')).toBeUndefined()
  await writeFile(join(directory, 'root.tex'), '% !TeX root = part.tex\n')
  await expect(sourceRoot(join(directory, 'part.tex'))).rejects.toThrow('cycle')
})

describe('PDF.js coordinate conversion', () => {
  it.each([0, 90, 180, 270])(
    'round-trips physical page coordinates with crop and rotation %i',
    async (rotation) => {
      vi.stubGlobal('DOMMatrix', DOMMatrix)
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const fixture = await PDFDocument.create()
      fixture.addPage([600, 800]).setCropBox(20, 30, 560, 720)
      const task = getDocument({ data: await fixture.save() })
      const pdf = await task.promise
      const viewport = (await pdf.getPage(1)).getViewport({ scale: 1.75, rotation })
      const target = {
        page: 1,
        x: 100,
        y: 150,
        width: 80,
        height: 10,
        requestId: 1,
        pageBox: [0, 0, 600, 800],
      }
      const [vx, vy] = viewport.convertToViewportPoint(100, 650)
      const point = pagePointFromClient(
        viewport,
        { left: 40, top: 70, width: viewport.width * 0.8, height: viewport.height * 0.8 },
        40 + vx * 0.8,
        70 + vy * 0.8,
      )
      expect(point.x).toBeCloseTo(100)
      expect(point.y + 800 - point.viewBox[3]).toBeCloseTo(150)
      const rect = viewportRectFromTarget(viewport, target)
      expect(rect.width * rect.height).toBeCloseTo(80 * 10 * 1.75 ** 2)
      expect(vx).toBeGreaterThanOrEqual(rect.left - 0.01)
      expect(vy).toBeGreaterThanOrEqual(rect.top - 0.01)
      await task.destroy()
    },
  )
})

const hasTex =
  spawnSync('pdflatex', ['--version']).status === 0 &&
  spawnSync('synctex', ['--version']).status === 0
it.skipIf(!hasTex)(
  'synchronizes a real included source in both directions with spaces and a separate build directory',
  async () => {
    const project = join(directory, 'real project')
    await cp(resolve('tests/fixtures/latex'), project, { recursive: true })
    const output = join(project, 'build output')
    await mkdir(output)
    for (let i = 0; i < 2; i++)
      execFileSync(
        'pdflatex',
        [
          '-interaction=batchmode',
          '-halt-on-error',
          '-synctex=1',
          `-output-directory=${output}`,
          'main.tex',
        ],
        { cwd: project, stdio: 'pipe' },
      )
    const pdf = join(output, 'main.pdf')
    const options = { executable: 'synctex', cwd: project }
    const target = await forward(options, pdf, join(project, 'chapter.tex'), 3, 1)
    expect(target.page).toBe(2)
    const result = await reverse(options, pdf, {
      page: target.page,
      x: target.x + 10,
      y: target.y + target.height / 2,
    })
    expect(await resolveInput(result.input, project, pdf, [])).toBe(join(project, 'chapter.tex'))
    expect(result.line).toBeGreaterThanOrEqual(2)
    await expect(
      forward(
        { ...options, executable: join(directory, 'no such executable') },
        pdf,
        join(project, 'chapter.tex'),
        3,
        1,
      ),
    ).rejects.toThrow('not found')
  },
)
