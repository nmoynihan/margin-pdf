import * as vscode from 'vscode'
import assert from 'node:assert/strict'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ReaderState } from '../../src/shared/vscode'

interface Probe {
  ready: boolean
  canvases: number
  state: ReaderState
  error?: string
  fileStatus?: string
  indicators: number
  previews: number
  links: number
  overflow: boolean
  bodyClass: string
  errors: string[]
  revision?: string
  pixel: number[]
}
const probe = (action?: string, value?: unknown) =>
  vscode.commands.executeCommand<Probe>('marginPdf.testProbe', action, value)
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: (value: Probe) => boolean, label: string, timeout = 30_000) {
  const started = Date.now()
  let last: Probe | undefined
  while (Date.now() - started < timeout) {
    last = await probe()
    if (last?.ready && check(last)) return last
    await delay(150)
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`)
}

export async function run() {
  const project = process.env.MARGIN_TEST_PROJECT!
  const extension = vscode.extensions.getExtension('margin-pdf.margin-pdf-reader')!
  assert(extension, 'Development extension is installed')
  await extension.activate()
  console.log('STEP: extension activated')
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await vscode.commands.executeCommand(
    'vscode.openWith',
    vscode.Uri.file(join(project, 'codec.pdf')),
    'marginPdf.reader',
  )
  const codecView = await until(
    (p) =>
      p.canvases > 0 &&
      p.pixel[0] > 180 &&
      p.pixel[1] < 60 &&
      p.pixel[2] < 60 &&
      p.pixel[3] === 255,
    'Bundled OpenJPEG WASM decodes a JPEG2000 image',
  )
  assert.deepEqual(codecView.errors, [])
  console.log('PASS: local rendering assets and OpenJPEG WASM decoding')
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  const chapter = await vscode.workspace.openTextDocument(
    vscode.Uri.file(join(project, 'chapter.tex')),
  )
  let editor = await vscode.window.showTextDocument(chapter, vscode.ViewColumn.One)
  editor.selection = new vscode.Selection(2, 1, 2, 1)
  await vscode.commands.executeCommand('marginPdf.openBeside')
  console.log('STEP: openBeside completed')
  let view = await until(
    (p) => p.canvases > 0 && p.links > 0,
    'PDF rendered with a real Blob worker',
  )
  assert.equal(view.state.snapshot.panes.length, 1)
  assert.equal(view.overflow, false)
  console.log('PASS: shared reader renders inside a real VS Code webview')

  await vscode.commands.executeCommand('marginPdf.syncFromCursor')
  view = await until(
    (p) => p.state.snapshot.panes[0].position.page === 2 && p.indicators > 0,
    'Forward SyncTeX reaches the included chapter',
  )
  const main = await vscode.workspace.openTextDocument(vscode.Uri.file(join(project, 'main.tex')))
  await vscode.window.showTextDocument(main, vscode.ViewColumn.One)
  await probe('click', {
    selector: '.active-pane .page[data-page-number="2"] .textLayer span',
    ctrl: true,
  })
  for (
    let i = 0;
    i < 50 && vscode.window.activeTextEditor?.document.uri.fsPath !== chapter.uri.fsPath;
    i++
  )
    await delay(100)
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, chapter.uri.fsPath)
  assert((vscode.window.activeTextEditor?.selection.active.line ?? -1) >= 1)
  await until((p) => !p.error, 'Inverse SyncTeX succeeds')
  console.log('PASS: source-to-PDF and Ctrl+click PDF-to-source SyncTeX')

  await probe('command', 'back')
  await until(
    (p) => p.state.snapshot.panes[0].position.page === 1 && p.links > 0,
    'Return to the linked first page',
  )
  await probe('hover', '.active-pane .linkAnnotation a')
  await until((p) => p.previews > 0, 'Hover previews remain available')
  await probe('click', { selector: '.active-pane .linkAnnotation a', ctrl: true })
  view = await until(
    (p) =>
      p.state.snapshot.panes.length === 2 &&
      p.state.snapshot.panes[1].position.page === 2 &&
      p.canvases >= 2,
    'Ctrl+click on a link creates the reference pane',
  )
  assert.equal(view.state.snapshot.panes[0].position.page, 1)
  assert.equal(view.state.snapshot.panes[1].position.page, 2)
  await probe('command', 'rotate')
  await probe('command', 'zoom-in')
  view = await until(
    (p) => p.state.snapshot.panes[0].position.rotation === 90,
    'Rotation is retained',
  )
  const saved = structuredClone(view.state.snapshot)
  editor = await vscode.window.showTextDocument(chapter, vscode.ViewColumn.One)
  editor.selection = new vscode.Selection(2, 1, 2, 1)
  await vscode.commands.executeCommand('marginPdf.syncFromCursor')
  view = await until(
    (p) => p.state.snapshot.panes[0].position.page === 2 && p.indicators > 0,
    'Forward SyncTeX works after rotation and zoom',
  )
  assert.equal(view.state.snapshot.panes[1].position.page, 2)
  console.log('PASS: link precedence, previews, independent panes, rotation and zoom')

  const pdf = join(project, 'build output', 'main.pdf')
  const beforeBuild = view.revision
  const mainPath = join(project, 'main.tex')
  await writeFile(
    mainPath,
    (await readFile(mainPath, 'utf8')).replace('Introduction', 'Rebuilt introduction'),
  )
  await promisify(execFile)(
    'pdflatex',
    [
      '-interaction=batchmode',
      '-halt-on-error',
      '-synctex=1',
      '-output-directory=build output',
      'main.tex',
    ],
    { cwd: project },
  )
  view = await until(
    (p) => p.revision !== beforeBuild && p.canvases > 0,
    'A real LaTeX rebuild reloads',
  )
  const bytes = await readFile(pdf)
  const previous = view.revision
  await writeFile(`${pdf}.replacement`, bytes)
  await rename(`${pdf}.replacement`, pdf)
  view = await until(
    (p) => p.revision !== previous && p.canvases > 0,
    'Atomic PDF replacement reloads',
  )
  assert.equal(view.state.snapshot.panes.length, 2)
  assert.equal(view.state.snapshot.panes[0].position.rotation, saved.panes[0].position.rotation)
  assert.equal(view.state.snapshot.panes[0].position.zoom, saved.panes[0].position.zoom)
  await writeFile(pdf, Buffer.from('temporarily incomplete PDF'))
  view = await until(
    (p) => /Keeping the current PDF/i.test(p.fileStatus ?? ''),
    'An incomplete build retains the readable version',
  )
  assert(view.canvases > 0)
  await writeFile(`${pdf}.replacement`, bytes)
  await rename(`${pdf}.replacement`, pdf)
  await until(
    (p) => !/Keeping the current PDF/i.test(p.fileStatus ?? '') && p.canvases > 0,
    'A valid replacement recovers',
  )
  await rename(pdf, `${pdf}.away`)
  await until(
    (p) => /temporarily unavailable/i.test(p.fileStatus ?? '') && p.canvases > 0,
    'A missing PDF retains the readable version',
  )
  await rename(`${pdf}.away`, pdf)
  await until(
    (p) => !/temporarily unavailable/i.test(p.fileStatus ?? '') && p.canvases > 0,
    'A returned PDF recovers',
  )
  console.log('PASS: atomic reload, position preservation and invalid-output recovery')

  await delay(600)
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  editor = await vscode.window.showTextDocument(chapter, vscode.ViewColumn.One)
  await vscode.commands.executeCommand('marginPdf.openBeside')
  view = await until(
    (p) => p.canvases > 0 && p.state.snapshot.panes.length === 2,
    'Reading state restores after reopening',
  )
  assert.equal(view.state.snapshot.panes[0].position.rotation, 90)
  const themes = vscode.extensions.all.flatMap(
    (e) => e.packageJSON.contributes?.themes ?? [],
  ) as Array<{ id?: string; label: string; uiTheme: string }>
  for (const kind of ['vs', 'vs-dark', 'hc-black']) {
    const theme = themes.find((theme) => theme.uiTheme === kind)
    assert(theme, `Built-in theme exists: ${kind}`)
    await vscode.workspace
      .getConfiguration('workbench')
      .update('colorTheme', theme.id ?? theme.label, vscode.ConfigurationTarget.Global)
    const cssClass =
      kind === 'vs' ? 'vscode-light' : kind === 'vs-dark' ? 'vscode-dark' : 'vscode-high-contrast'
    view = await until((p) => p.bodyClass.includes(cssClass), `${kind} theme is applied`)
    assert.equal(view.overflow, false)
    assert.deepEqual(view.errors, [])
  }
  console.log('PASS: workspace state restoration and light/dark/high-contrast themes')
}
