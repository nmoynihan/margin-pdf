import * as vscode from 'vscode'
import { createHash, randomBytes } from 'node:crypto'
import { dirname, resolve, extname } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { DocumentMonitor } from '../../../src/main/DocumentMonitor'
import { describePdf, readPdf } from '../../../src/shared/pdf-file'
import { sanitizeSession } from '../../../src/shared/session'
import type { DocumentDescriptor } from '../../../src/shared/types'
import type { PdfPoint, SyncTarget } from '../../../src/shared/reader-host'
import type { HostMessage, ReaderState, WebviewMessage } from '../../../src/shared/vscode'
import { conventionalPdf, exists, resolveInput, sourceRoot } from './paths'
import { forward, reverse } from './synctex'

interface Pairing {
  pdf: string
  cwd: string
}
interface Panel {
  webviewPanel: vscode.WebviewPanel
  ready: boolean
  target?: SyncTarget
}
interface PdfDocument extends vscode.CustomDocument {
  id: string
  descriptor: DocumentDescriptor
  panels: Set<Panel>
  boxes?: { revision?: string; values: number[][] }
}
const viewType = 'marginPdf.reader'
const html = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

export function activate(context: vscode.ExtensionContext) {
  const documents = new Map<string, PdfDocument>()
  let requestId = 0
  let forwardVersion = 0
  let reverseVersion = 0
  const probes = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>()
  const pairings = new Map(
    Object.entries(context.workspaceState.get<Record<string, Pairing>>('pairings', {})),
  )
  const post = (panel: Panel, message: HostMessage) =>
    panel.webviewPanel.webview.postMessage(message)
  const monitor = new DocumentMonitor(
    async (id) => {
      const document = documents.get(id)
      if (!document) throw new Error('Document closed.')
      return describePdf(document.uri.fsPath, id)
    },
    (change) => {
      const document = documents.get(change.id)
      if (!document) return
      if (change.descriptor) document.descriptor = change.descriptor
      for (const panel of document.panels)
        if (panel.ready) void post(panel, { type: 'change', change })
    },
  )
  context.subscriptions.push({ dispose: () => monitor.stop() })
  const updateMonitor = () =>
    monitor.setDocuments([...documents.values()].map((document) => document.descriptor))
  const guardLocal = (uri?: vscode.Uri) => {
    if (vscode.env.remoteName || (uri && uri.scheme !== 'file'))
      throw new Error(
        'Margin PDF currently supports local desktop files. Remote workspaces are not supported yet.',
      )
  }
  const guardSync = () => {
    guardLocal()
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace to run SyncTeX.')
  }
  const report = (operation: () => Promise<unknown>) =>
    operation().catch((error: Error) => {
      console.error('Margin PDF:', error.message)
      void vscode.window.showErrorMessage(error.message)
    })
  const savePairing = async (source: string, root: string, pairing: Pairing) => {
    pairings.set(source, pairing)
    pairings.set(root, pairing)
    await context.workspaceState.update('pairings', Object.fromEntries(pairings))
  }
  const resolvePdf = async (
    source: vscode.Uri,
    select = false,
  ): Promise<vscode.Uri | undefined> => {
    guardLocal(source)
    if (extname(source.fsPath).toLowerCase() === '.pdf') return source
    const root = await sourceRoot(source.fsPath)
    const pairing = pairings.get(source.fsPath) ?? pairings.get(root)
    if (!select && pairing && (await exists(pairing.pdf))) return vscode.Uri.file(pairing.pdf)
    const outDir = vscode.workspace
      .getConfiguration('latex-workshop', vscode.Uri.file(root))
      .get<string>('latex.outDir', '%DIR%')
    const conventional = conventionalPdf(root, outDir)
    let pdf =
      !select && conventional && (await exists(conventional))
        ? vscode.Uri.file(conventional)
        : undefined
    if (!pdf) {
      const selected = await vscode.window.showOpenDialog({
        title: 'Associate this source with its compiled PDF',
        defaultUri: vscode.Uri.file(conventional ?? dirname(root)),
        filters: { PDF: ['pdf'] },
        canSelectMany: false,
      })
      pdf = selected?.[0]
    }
    if (pdf) await savePairing(source.fsPath, root, { pdf: pdf.fsPath, cwd: dirname(root) })
    return pdf
  }
  const cwdFor = (pdf: string) =>
    [...pairings.values()].find((p) => p.pdf === pdf)?.cwd ?? dirname(pdf)
  const options = (uri: vscode.Uri) => {
    const config = vscode.workspace.getConfiguration('marginPdf', uri)
    const directory = config.get<string>('synctexDirectory', '')
    const cwd = cwdFor(uri.fsPath)
    return {
      executable: config.get<string>('synctexPath', 'synctex'),
      cwd,
      directory: directory ? resolve(cwd, directory) : undefined,
    }
  }
  const pageBox = async (document: PdfDocument, page: number) => {
    if (!document.boxes || document.boxes.revision !== document.descriptor.revision) {
      const pdf = await PDFDocument.load(await readPdf(document.uri.fsPath), {
        ignoreEncryption: true,
        updateMetadata: false,
      })
      document.boxes = {
        revision: document.descriptor.revision,
        values: pdf.getPages().map((p) => {
          const box = p.getMediaBox()
          return [box.x, box.y, box.x + box.width, box.y + box.height]
        }),
      }
    }
    const box = document.boxes.values[page - 1]
    if (!box) throw new Error('SyncTeX returned a page outside this PDF. Rebuild and try again.')
    return box
  }
  const savedState = (document: PdfDocument, value: unknown): ReaderState | undefined => {
    if (!value || typeof value !== 'object') return
    const state = value as ReaderState
    const clean = sanitizeSession({ version: 1, tabs: [state.snapshot], sidebar: state.sidebar })
    const snapshot = clean.tabs.find((tab) => tab.documentId === document.id)
    return snapshot ? { snapshot, sidebar: clean.sidebar } : undefined
  }
  const provider: vscode.CustomReadonlyEditorProvider<PdfDocument> = {
    async openCustomDocument(uri) {
      guardLocal(uri)
      const id = createHash('sha256')
        .update(process.platform === 'win32' ? uri.fsPath.toLowerCase() : uri.fsPath)
        .digest('hex')
        .slice(0, 32)
      const document: PdfDocument = {
        id,
        uri,
        descriptor: await describePdf(uri.fsPath, id),
        panels: new Set(),
        dispose() {
          documents.delete(id)
          updateMonitor()
        },
      }
      documents.set(id, document)
      updateMonitor()
      return document
    },
    async resolveCustomEditor(document, webviewPanel) {
      const panel: Panel = { webviewPanel, ready: false }
      document.panels.add(panel)
      const media = vscode.Uri.joinPath(context.extensionUri, 'dist', 'media')
      webviewPanel.webview.options = { enableScripts: true, localResourceRoots: [media] }
      const resource = (path: string) =>
        webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(media, path)).toString()
      const nonce = randomBytes(16).toString('hex')
      const source = webviewPanel.webview.cspSource
      webviewPanel.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${source} 'wasm-unsafe-eval'; style-src ${source} 'unsafe-inline'; img-src ${source} data: blob:; font-src ${source} blob:; connect-src ${source}; worker-src blob:; object-src 'none'; base-uri 'none'; form-action 'none';"><meta name="margin-assets" content="${html(resource('pdfjs/'))}"><meta name="margin-testing" content="${context.extensionMode === vscode.ExtensionMode.Test}"><link rel="stylesheet" href="${html(resource('reader.css'))}"></head><body><div id="root"></div><script nonce="${nonce}" type="module" src="${html(resource('reader.js'))}"></script></body></html>`
      const listener = webviewPanel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
        if (!message || typeof message !== 'object') return
        if (message.type === 'ready') {
          panel.ready = true
          void post(panel, {
            type: 'change',
            change: { id: document.id, descriptor: document.descriptor },
          })
          if (panel.target) void post(panel, { type: 'sync', target: panel.target })
          return
        }
        if (
          message.type === 'probe-result' &&
          context.extensionMode === vscode.ExtensionMode.Test
        ) {
          probes.get(message.id)?.resolve(message.value)
          return
        }
        if (message.type !== 'request' || !Number.isSafeInteger(message.id) || message.id < 0)
          return
        try {
          let value: unknown
          switch (message.method) {
            case 'bootstrap':
              value = {
                descriptor: document.descriptor,
                state: savedState(document, context.workspaceState.get(`reader:${document.id}`)),
              }
              break
            case 'read':
              value = (await readPdf(document.uri.fsPath)).toString('base64')
              break
            case 'save': {
              const state = savedState(document, message.args)
              if (!state) throw new Error('Invalid reading state.')
              await context.workspaceState.update(`reader:${document.id}`, state)
              break
            }
            case 'close':
              webviewPanel.dispose()
              break
            case 'external': {
              if (
                typeof message.args !== 'string' ||
                message.args.length > 8192 ||
                !/^(https?:|mailto:)/i.test(message.args)
              )
                throw new Error('This link type is not supported.')
              await vscode.env.openExternal(vscode.Uri.parse(message.args))
              break
            }
            case 'reverse': {
              guardSync()
              const point = message.args as PdfPoint
              if (
                !point ||
                !Number.isInteger(point.page) ||
                point.page < 1 ||
                !Number.isFinite(point.x) ||
                !Number.isFinite(point.y) ||
                !Array.isArray(point.viewBox) ||
                point.viewBox.length !== 4 ||
                !point.viewBox.every(Number.isFinite)
              )
                throw new Error('Invalid PDF coordinates.')
              const version = ++reverseVersion
              const box = await pageBox(document, point.page)
              const result = await reverse(options(document.uri), document.uri.fsPath, {
                page: point.page,
                x: point.x - box[0],
                y: point.y + box[3] - point.viewBox[3],
              })
              const input = await resolveInput(
                result.input,
                cwdFor(document.uri.fsPath),
                document.uri.fsPath,
                (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
              )
              if (version !== reverseVersion) break
              const sourceDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(input))
              if (version !== reverseVersion) break
              const line = Math.min(sourceDocument.lineCount - 1, result.line - 1)
              const column = Math.min(
                sourceDocument.lineAt(line).text.length,
                Math.max(0, result.column - 1),
              )
              const editor = await vscode.window.showTextDocument(sourceDocument, {
                viewColumn:
                  vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === input)
                    ?.viewColumn ?? vscode.ViewColumn.One,
                preserveFocus: false,
                preview: false,
              })
              const position = new vscode.Position(line, column)
              editor.selection = new vscode.Selection(position, position)
              editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenterIfOutsideViewport,
              )
              break
            }
            default:
              throw new Error('Unknown reader request.')
          }
          void post(panel, { type: 'result', id: message.id, value })
        } catch (error) {
          void post(panel, { type: 'result', id: message.id, error: (error as Error).message })
        }
      })
      webviewPanel.onDidDispose(() => {
        listener.dispose()
        document.panels.delete(panel)
      })
    },
  }
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(viewType, provider, {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )
  const sourceUri = (uri?: vscode.Uri) => uri ?? vscode.window.activeTextEditor?.document.uri
  const openBeside = async (uri?: vscode.Uri, select = false) => {
    const source = sourceUri(uri)
    if (!source) throw new Error('Open a LaTeX source or select a PDF first.')
    const pdf = await resolvePdf(source, select)
    if (pdf)
      await vscode.commands.executeCommand('vscode.openWith', pdf, viewType, {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
        preview: false,
      })
    return pdf
  }
  const syncFromCursor = async () => {
    guardSync()
    const editor = vscode.window.activeTextEditor
    if (!editor) throw new Error('Place the cursor in a LaTeX source file first.')
    const version = ++forwardVersion
    const source = editor.document.uri.fsPath
    const line = editor.selection.active.line + 1
    const column = editor.selection.active.character + 1
    const pdf = await resolvePdf(editor.document.uri)
    if (!pdf || version !== forwardVersion) return
    const target = await forward(options(pdf), pdf.fsPath, source, line, column)
    if (version !== forwardVersion) return
    let document = [...documents.values()].find((d) => d.uri.toString() === pdf.toString())
    if (!document?.panels.size) {
      await vscode.commands.executeCommand('vscode.openWith', pdf, viewType, {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
        preview: false,
      })
      document = [...documents.values()].find((d) => d.uri.toString() === pdf.toString())
    }
    if (!document || version !== forwardVersion) return
    const latest = await describePdf(document.uri.fsPath, document.id)
    if (latest.revision !== document.descriptor.revision) {
      document.descriptor = latest
      for (const open of document.panels)
        if (open.ready)
          void post(open, { type: 'change', change: { id: document.id, descriptor: latest } })
    }
    const pageBounds = await pageBox(document, target.page)
    if (version !== forwardVersion) return
    const panel =
      [...document.panels].find((p) => p.webviewPanel.visible) ?? [...document.panels][0]
    if (!panel) return
    panel.webviewPanel.reveal(panel.webviewPanel.viewColumn, true)
    panel.target = { ...target, pageBox: pageBounds, requestId: ++requestId }
    if (panel.ready) await post(panel, { type: 'sync', target: panel.target })
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('marginPdf.openBeside', (uri?: vscode.Uri) =>
      report(() => openBeside(uri)),
    ),
    vscode.commands.registerCommand('marginPdf.selectPdf', () =>
      report(() => openBeside(undefined, true)),
    ),
    vscode.commands.registerCommand('marginPdf.syncFromCursor', () => report(syncFromCursor)),
  )
  if (context.extensionMode === vscode.ExtensionMode.Test)
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'marginPdf.testProbe',
        async (action?: string, value?: unknown) => {
          const document = [...documents.values()][0]
          const panel = document && [...document.panels][0]
          if (!panel?.ready) return { ready: false }
          const id = ++requestId
          return new Promise((resolveProbe, reject) => {
            const timer = setTimeout(() => {
              probes.delete(id)
              reject(new Error('Webview probe timed out.'))
            }, 10_000)
            probes.set(id, {
              resolve(value) {
                clearTimeout(timer)
                probes.delete(id)
                resolveProbe(value)
              },
              reject,
            })
            void post(panel, { type: 'probe', id, action, value })
          })
        },
      ),
    )
}
