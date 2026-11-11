import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import electronPath from 'electron'
import { mkdtemp, readFile, copyFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'

let app: ElectronApplication
let page: Page
let userData: string
let errors: string[]

async function launch(file?: string, directory?: string, fileURL = false, safeMode = false) {
  userData = directory ?? (await mkdtemp(join(tmpdir(), 'margin-pdf-e2e-')))
  errors = []
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [
      ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []),
      ...(process.env.MARGIN_PDF_HEADLESS === '1'
        ? ['--ozone-platform=headless']
        : process.env.MARGIN_PDF_OZONE_PLATFORM
          ? [`--ozone-platform=${process.env.MARGIN_PDF_OZONE_PLATFORM}`]
          : []),
      resolve('out/main/index.js'),
      ...(safeMode ? ['--safe-mode'] : []),
      ...(file
        ? [
            fileURL
              ? pathToFileURL(resolve('tests/fixtures', file)).href
              : resolve('tests/fixtures', file),
          ]
        : []),
    ],
    env: { ...process.env, MARGIN_PDF_USER_DATA: userData, ELECTRON_RENDERER_URL: '' },
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await expect(page.locator('.app-wordmark')).toBeVisible()
  if (file && file !== 'password.pdf' && file !== 'invalid.pdf')
    await expect(page.locator('.reader-pane canvas').first()).toBeVisible()
  return page
}

async function internalLink(pane = page.locator('.reader-pane').first(), index = 0) {
  const link = pane.locator('.page[data-page-number="1"] .linkAnnotation a').nth(index)
  await link.scrollIntoViewIfNeeded()
  return link
}

test.afterEach(async () => {
  if (app) {
    await app.close().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  expect(errors ?? []).toEqual([])
})

test('welcome screen opens the bundled sample offline', async () => {
  await launch()
  await expect(page.getByRole('button', { name: 'Open sample PDF' })).toBeVisible()
  await page.screenshot({ path: 'test-results/welcome.png' })
  await page.getByRole('button', { name: 'Open sample PDF' }).click()
  await expect(page.locator('.reader-pane canvas').first()).toBeVisible()
  await expect(page.locator('.document-title')).toHaveText('Sample paper on PDF navigation')
  await expect(page.locator('.outline-entry').first()).toContainText('Introduction')
  await expect
    .poll(() =>
      page.locator('.app-header').evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBe(0)
  await page.screenshot({ path: 'test-results/reader.png' })
})

test('hover renders a selectable preview without moving the source and stays open inside', async () => {
  await launch('paper.pdf')
  const source = page.locator('.reader-pane').first()
  const link = await internalLink(source)
  const before = await source.locator('.pdf-container').evaluate((element) => element.scrollTop)
  await link.hover()
  await expect(page.getByRole('dialog', { name: 'Link preview' })).toBeVisible()
  await expect(page.locator('.preview-page')).toHaveText('Page 4')
  await expect(page.locator('.preview-page-host canvas')).toBeVisible()
  await expect(page.locator('.preview-page-host .textLayer span').first()).toBeAttached()
  await page.getByRole('dialog', { name: 'Link preview' }).hover()
  await page.waitForTimeout(400)
  await expect(page.locator('.link-preview')).toBeVisible()
  await page.locator('.preview-viewport').evaluate((element) => {
    element.scrollTop += 75
  })
  expect(await source.locator('.pdf-container').evaluate((element) => element.scrollTop)).toBe(
    before,
  )
  const box = await page.locator('.link-preview').boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  await page.screenshot({ path: 'test-results/hover-preview.png' })
  await page.keyboard.press('Escape')
  await expect(page.locator('.link-preview')).toHaveCount(0)
})

test('Ctrl+click reuses the opposite pane in either direction, with independent zoom and history', async () => {
  await launch('paper.pdf')
  const link = await internalLink()
  const sourceCoordinate = () =>
    page
      .locator('.reader-pane')
      .first()
      .evaluate((pane) => {
        const container = pane.querySelector('.pdf-container')!
        const pdfPage = pane.querySelector('.page[data-page-number="1"]')!
        const factor = parseFloat(
          getComputedStyle(pane.querySelector('.pdfViewer')!).getPropertyValue('--scale-factor'),
        )
        return (
          (container.getBoundingClientRect().top - pdfPage.getBoundingClientRect().top) / factor
        )
      })
  const sourceBefore = await sourceCoordinate()
  await link.click({ modifiers: ['Control'] })
  await expect(page.locator('.reader-pane')).toHaveCount(2)
  const source = page.locator('.reader-pane').nth(0),
    reference = page.locator('.reader-pane').nth(1)
  await expect(source.getByRole('textbox', { name: 'Page number' })).toHaveValue('1')
  await expect(reference.getByRole('textbox', { name: 'Page number' })).toHaveValue('4')
  await expect.poll(async () => Math.abs((await sourceCoordinate()) - sourceBefore)).toBeLessThan(3)
  await source.getByRole('combobox', { name: 'Zoom' }).selectOption('1.5')
  await expect(source.getByRole('combobox', { name: 'Zoom' })).toHaveValue('custom')
  await expect(reference.getByRole('combobox', { name: 'Zoom' })).toHaveValue('page-width')
  const back = reference.locator('.page[data-page-number="4"] .linkAnnotation a').first()
  await back.scrollIntoViewIfNeeded()
  await back.click({ modifiers: ['Control'] })
  await expect(page.locator('.reader-pane')).toHaveCount(2)
  await expect(reference.getByRole('textbox', { name: 'Page number' })).toHaveValue('4')
  await expect(source.getByRole('button', { name: 'Back', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Stack panes vertically' }).click()
  await expect(page.locator('.split-area')).toHaveClass(/vertical/)
  await page.screenshot({ path: 'test-results/split-reader.png' })
  await reference.getByRole('button', { name: 'Close pane' }).click()
  await expect(page.locator('.reader-pane')).toHaveCount(1)
  await expect(source.getByRole('combobox', { name: 'Zoom' })).toHaveValue('custom')
})

test('search, thumbnails, rotation, and returning from a normal link work', async () => {
  await launch('paper.pdf')
  await page.getByRole('button', { name: 'Find in paper', exact: true }).click()
  await page.getByRole('textbox', { name: 'Find in paper' }).fill('context')
  await expect(page.locator('.match-count')).toContainText(/\d+ \/ [1-9]/)
  await page.getByRole('button', { name: 'Next match' }).click()
  await page.getByRole('button', { name: 'Close search' }).click()
  await page.getByRole('button', { name: 'Page thumbnails' }).click()
  await page.getByRole('button', { name: 'Go to page 5', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Page number' })).toHaveValue('5')
  await page.getByRole('button', { name: 'Rotate clockwise', exact: true }).click()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Page number' })).not.toHaveValue('5')
})

test('Ctrl plus and minus zoom only the active PDF pane, including equals and numpad keys', async () => {
  await launch('paper.pdf')
  const source = page.locator('.reader-pane').first()
  const scale = (pane: typeof source) =>
    pane
      .locator('.pdfViewer')
      .evaluate(
        (element) =>
          parseFloat(getComputedStyle(element).getPropertyValue('--scale-factor')) / (4 / 3),
      )
  const expectScale = (pane: typeof source, expected: number) =>
    expect.poll(() => scale(pane)).toBeCloseTo(expected, 5)

  await source.getByRole('combobox', { name: 'Zoom' }).selectOption('1')
  await expectScale(source, 1)
  await page.keyboard.press('Control+Equal')
  await expectScale(source, 1.2)
  await page.keyboard.press('Control+Shift+Equal')
  await expectScale(source, 1.44)
  await page.keyboard.press('Control+Minus')
  await expectScale(source, 1.2)
  await page.keyboard.press('Control+NumpadAdd')
  await expectScale(source, 1.44)
  await page.keyboard.press('Control+NumpadSubtract')
  await expectScale(source, 1.2)

  for (const [keyCode, expected] of [
    ['+', 1.44],
    ['-', 1.2],
  ] as const) {
    await app.evaluate(({ BrowserWindow }, keyCode) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.focus()
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] })
    }, keyCode)
    await expectScale(source, expected)
  }

  if (process.platform === 'darwin') {
    await page.keyboard.press('Meta+Equal')
    await expectScale(source, 1.44)
    await page.keyboard.press('Meta+Minus')
    await expectScale(source, 1.2)
  }

  await page.getByRole('button', { name: 'Toggle split view', exact: true }).click()
  const reference = page.locator('.reader-pane').nth(1)
  await reference.getByRole('combobox', { name: 'Zoom' }).selectOption('0.75')
  await reference.locator('.pdf-container').focus()
  await expect(reference).toHaveClass(/active-pane/)
  await page.keyboard.press('Control+Equal')
  await expectScale(reference, 0.9)
  await expectScale(source, 1.2)
  await page.keyboard.press('Control+Minus')
  await expectScale(reference, 0.75)
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
    ),
  ).toBe(1)
})

test('PDF text can be selected and copied through the native edit shortcut', async () => {
  await launch('paper.pdf')
  await expect(page.locator('.reader-pane .textLayer span').first()).toBeAttached()
  await page.locator('.pdf-container').focus()
  await page.evaluate(() => {
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('.reader-pane .textLayer span')!)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
  })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c')
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain('MARGIN PDF')
  expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined')
})

test('restores both pane positions, layout, zoom, and theme after restart', async () => {
  await launch('paper.pdf')
  await (await internalLink()).click({ modifiers: ['Control'] })
  await expect(page.locator('.reader-pane')).toHaveCount(2)
  await expect(
    page.locator('.reader-pane').nth(1).getByRole('textbox', { name: 'Page number' }),
  ).toHaveValue('4')
  await page.getByRole('button', { name: 'Stack panes vertically' }).click()
  await page.getByRole('combobox', { name: 'Colour theme' }).selectOption('dark')
  await page
    .locator('.reader-pane')
    .first()
    .getByRole('combobox', { name: 'Zoom' })
    .selectOption('1.25')
  await app.close()
  const saved = JSON.parse(await readFile(join(userData, 'reader-state.json'), 'utf8'))
  expect(saved.session.tabs[0].panes).toHaveLength(2)
  expect(saved.session.tabs[0].orientation).toBe('vertical')
  await launch(undefined, userData)
  await expect(page.locator('.reader-pane')).toHaveCount(2)
  await expect(
    page.locator('.reader-pane').nth(1).getByRole('textbox', { name: 'Page number' }),
  ).toHaveValue('4')
  await expect(page.locator('.split-area')).toHaveClass(/vertical/)
  await expect(page.getByRole('combobox', { name: 'Colour theme' })).toHaveValue('dark')
  await expect(
    page.locator('.reader-pane').first().getByRole('combobox', { name: 'Zoom' }),
  ).toHaveValue('custom')
})

test('page navigation saves its position before delayed scroll animation frames', async () => {
  await launch('paper.pdf')
  await page.evaluate(() => {
    const frame = window.requestAnimationFrame.bind(window)
    const cancel = window.cancelAnimationFrame.bind(window)
    const pending = new Map<number, FrameRequestCallback>()
    let sequence = 1_000_000
    window.requestAnimationFrame = (callback) => {
      pending.set(++sequence, callback)
      return sequence
    }
    window.cancelAnimationFrame = (id) => {
      if (!pending.delete(id)) cancel(id)
    }
    ;(window as unknown as { resumeFrames: () => void }).resumeFrames = () => {
      window.requestAnimationFrame = frame
      window.cancelAnimationFrame = cancel
      for (const callback of pending.values()) frame(callback)
      pending.clear()
    }
  })
  try {
    const input = page.getByRole('textbox', { name: 'Page number' })
    await input.fill('3')
    await input.press('Enter')
    await expect(input).toHaveValue('3')
    await expect
      .poll(async () => {
        const state = JSON.parse(await readFile(join(userData, 'reader-state.json'), 'utf8'))
        return state.session.tabs[0]?.panes[0]?.position.page
      })
      .toBe(3)
  } finally {
    await page.evaluate(() => (window as unknown as { resumeFrames: () => void }).resumeFrames())
  }
})

test('password handling allows retry without storing the password', async () => {
  await launch('password.pdf')
  await page.getByRole('textbox', { name: 'PDF password' }).fill('wrong')
  await page.getByRole('button', { name: 'Unlock paper' }).click()
  await expect(page.getByText('That password didn’t work.')).toBeVisible()
  await page.getByRole('textbox', { name: 'PDF password' }).fill('read')
  await page.getByRole('button', { name: 'Unlock paper' }).click()
  await expect(page.locator('.reader-pane canvas')).toBeVisible()
  await app.close()
  const saved = await readFile(join(userData, 'reader-state.json'), 'utf8')
  expect(saved).not.toContain('"password"')
  expect(saved).not.toContain('wrong')
})

test('invalid files show a recoverable document error', async () => {
  await launch('invalid.pdf')
  await expect(page.getByRole('heading', { name: 'We couldn’t open this paper' })).toBeVisible()
  await page.getByRole('button', { name: 'Close tab', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open sample PDF' })).toBeVisible()
})

test('OS file URLs with escaped spaces open as native PDF paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'margin-pdf file URL-'))
  const filename = join(directory, 'paper with spaces.pdf')
  await copyFile(resolve('tests/fixtures/paper.pdf'), filename)
  await launch(filename, undefined, true)
  await expect(page.locator('.document-title')).toHaveText('Sample paper on PDF navigation')
})

test('long PDFs render lazily and accept distant page navigation', async () => {
  await launch('long.pdf')
  const input = page.getByRole('textbox', { name: 'Page number' })
  await input.fill('120')
  await input.press('Enter')
  await expect(input).toHaveValue('120')
  await expect(page.locator('.page[data-page-number="120"] canvas')).toBeVisible()
  expect(await page.locator('.reader-pane canvas').count()).toBeLessThan(20)
})

test('scanned PDFs render faithfully without an invented text layer', async () => {
  await launch('scanned.pdf')
  // PDF.js can briefly retain the previous canvas while a resized raster completes.
  await expect(page.locator('.reader-pane canvas').first()).toBeVisible()
  await expect(page.locator('.reader-pane .textLayer span')).toHaveCount(0)
})

test('rapid hover changes, keyboard previews, and unavailable targets do not disturb reading', async () => {
  await launch('paper.pdf')
  const first = await internalLink()
  await first.hover()
  await page.waitForTimeout(100)
  const figure = await internalLink(page.locator('.reader-pane').first(), 2)
  await figure.hover()
  await expect(page.locator('.preview-page')).toHaveText('Page 3')
  await expect(page.locator('.preview-page-host canvas')).toBeVisible()
  await page.keyboard.press('Escape')
  const unavailable = await internalLink(page.locator('.reader-pane').first(), 5)
  await unavailable.focus()
  await expect(page.locator('.preview-message')).toContainText('no available destination')
  await expect(page.getByRole('button', { name: 'Open in other pane', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await unavailable.click({ modifiers: ['Control'] })
  await expect(page.getByRole('alert')).toContainText('no available destination')
  await expect(page.locator('.reader-pane')).toHaveCount(1)
})

test('multiple tabs retain their views, duplicate opens focus a tab, and closed tabs remember their position', async () => {
  await launch('paper.pdf')
  const source = page.locator('.tab-panel:not([hidden])')
  await source.getByRole('textbox', { name: 'Page number' }).fill('3')
  await source.getByRole('textbox', { name: 'Page number' }).press('Enter')
  await expect(source.getByRole('textbox', { name: 'Page number' })).toHaveValue('3')
  await source.getByRole('combobox', { name: 'Zoom' }).selectOption('1')
  const chooseFile = async (name: string) => {
    await app.evaluate(
      ({ dialog }, filename) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] })
      },
      resolve('tests/fixtures', name),
    )
    await page.locator('.open-button').click()
  }
  await chooseFile('scanned.pdf')
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.locator('.tab-panel:not([hidden]) .document-title')).toHaveText(
    'Scanned document fixture',
  )
  await page.getByRole('tab', { name: 'Sample paper on PDF navigation' }).click()
  await expect(
    page.locator('.tab-panel:not([hidden])').getByRole('textbox', { name: 'Page number' }),
  ).toHaveValue('3')
  // A duplicate open must finish focusing the requested tab before it is closed.
  // The tab count is already two, so it cannot signal completion of that request.
  await page.getByRole('tab', { name: 'Scanned document fixture' }).click()
  await chooseFile('paper.pdf')
  await expect(page.getByRole('tab', { name: 'Sample paper on PDF navigation' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('tab')).toHaveCount(2)
  await page.getByRole('button', { name: 'Close paper.pdf', exact: true }).click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.locator('.tab-panel:not([hidden]) canvas').first()).toBeVisible()
  await chooseFile('paper.pdf')
  await expect(
    page.locator('.tab-panel:not([hidden])').getByRole('textbox', { name: 'Page number' }),
  ).toHaveValue('3')
  await expect(
    page.locator('.tab-panel:not([hidden])').getByRole('combobox', { name: 'Zoom' }),
  ).toHaveValue('custom')
})

test('closing a pane during a preview keeps the remaining viewer usable', async () => {
  await launch('paper.pdf')
  await (await internalLink()).click({ modifiers: ['Control'] })
  await expect(page.locator('.reader-pane')).toHaveCount(2)
  const reference = page.locator('.reader-pane').nth(1)
  await expect(reference.getByRole('textbox', { name: 'Page number' })).toHaveValue('4')
  const back = reference.locator('.page[data-page-number="4"] .linkAnnotation a').first()
  await back.hover()
  await expect(page.locator('.link-preview')).toBeVisible()
  await page.keyboard.press('Escape')
  await reference.getByRole('button', { name: 'Close pane' }).click()
  await expect(page.locator('.reader-pane')).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Zoom' }).selectOption('1')
  await page.getByRole('button', { name: 'Rotate clockwise', exact: true }).click()
  await expect(page.locator('.reader-pane canvas').first()).toBeVisible()
})

test('print preparation produces every PDF page instead of printing reader controls', async () => {
  await launch('paper.pdf')
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    ;(globalThis as any).printedPDF = null
    contents.print = (_options: any, callback: any) => {
      void contents
        .printToPDF({ printBackground: true, preferCSSPageSize: true })
        .then((bytes) => {
          ;(globalThis as any).printedPDF = bytes.toString('base64')
          callback(true)
        })
        .catch((error) => callback(false, error.message))
    }
  })
  await page.getByRole('button', { name: 'Print paper', exact: true }).click()
  await expect
    .poll(() => app.evaluate(() => (globalThis as any).printedPDF?.length ?? 0), {
      timeout: 30_000,
    })
    .toBeGreaterThan(1000)
  await expect(page.getByRole('dialog', { name: 'Prepare printing' })).toHaveCount(0, {
    timeout: 30_000,
  })
  const printed = await PDFDocument.load(
    Buffer.from(await app.evaluate(() => (globalThis as any).printedPDF), 'base64'),
  )
  expect(printed.getPageCount()).toBe(5)
  expect(printed.getPage(4).getWidth()).toBeGreaterThan(printed.getPage(4).getHeight())
})

test('print preparation can be cancelled without opening a native dialog', async () => {
  await launch('long.pdf')
  await app.evaluate(({ BrowserWindow }) => {
    ;(globalThis as any).nativePrintCalls = 0
    BrowserWindow.getAllWindows()[0].webContents.print = (_options: any, callback: any) => {
      ;(globalThis as any).nativePrintCalls++
      callback(true)
    }
  })
  await page.getByRole('button', { name: 'Print paper', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Prepare printing' })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: 'Prepare printing' })).toHaveCount(0)
  await expect(page.locator('#print-pages')).toHaveCount(0)
  expect(await app.evaluate(() => (globalThis as any).nativePrintCalls)).toBe(0)
})

test('clearing recent before the debounce removes disk paths and revokes the old handle', async () => {
  await launch('paper.pdf')
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(join(userData, 'reader-state.json'), 'utf8')).session.tabs.length,
    )
    .toBe(1)
  const saved = JSON.parse(await readFile(join(userData, 'reader-state.json'), 'utf8'))
  const id: string = saved.files[0].id
  const path: string = saved.files[0].path
  await page.getByRole('button', { name: 'Close paper.pdf', exact: true }).click()
  await page.getByRole('button', { name: 'Clear recent', exact: true }).click()
  await page.waitForTimeout(500)
  const persisted = await readFile(join(userData, 'reader-state.json'), 'utf8')
  expect(persisted).not.toContain(path)
  expect(JSON.parse(persisted).files).toEqual([])
  expect(JSON.parse(persisted).session.tabs).toEqual([])
  expect(
    await page.evaluate(async (id) => {
      try {
        await window.desktop.readDocument(id)
        return 'still accessible'
      } catch (error) {
        return (error as Error).message
      }
    }, id),
  ).toContain('Unknown document')
})

test('OS opens during native registration and renderer restoration are each delivered once', async () => {
  await launch('paper.pdf')
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(join(userData, 'reader-state.json'), 'utf8')).session.tabs.length,
    )
    .toBe(1)
  await app.evaluate(
    ({ app, ipcMain }, paths) => {
      const handlers = (
        ipcMain as unknown as {
          _invokeHandlers: Map<
            string,
            (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
          >
        }
      )._invokeHandlers
      const bootstrap = handlers.get('bootstrap')!
      const reopen = handlers.get('reopen')!
      ipcMain.removeHandler('bootstrap')
      ipcMain.handle('bootstrap', async (event) => {
        app.emit('open-file', { preventDefault() {} } as Electron.Event, paths[0])
        const pending = bootstrap(event)
        // The bootstrap call has captured its queue and is awaiting registration.
        app.emit('open-file', { preventDefault() {} } as Electron.Event, paths[1])
        return pending
      })
      ipcMain.removeHandler('reopen')
      ipcMain.handle('reopen', async (event, id) => {
        app.emit('open-file', { preventDefault() {} } as Electron.Event, paths[2])
        await new Promise((resolve) => setTimeout(resolve, 200))
        return reopen(event, id)
      })
    },
    ['scanned.pdf', 'long.pdf', 'password.pdf'].map((file) => resolve('tests/fixtures', file)),
  )
  await page.evaluate(() => {
    void window.desktop.restart(false)
  })
  await expect(page.getByRole('tab')).toHaveCount(4)
  for (const name of ['paper.pdf', 'scanned.pdf', 'long.pdf', 'password.pdf'])
    await expect(page.locator(`.document-tab-button [role="tab"][title="${name}"]`)).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'PDF password' })).toBeVisible()
})

test('keyboard preview entry persists through focus and returns focus on dismissal and navigation', async () => {
  await launch('paper.pdf')
  const link = await internalLink()
  await link.focus()
  await expect(page.getByRole('dialog', { name: 'Link preview' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open here', exact: true })).toBeEnabled()
  await page.keyboard.press('Alt+ArrowDown')
  await expect(page.getByRole('button', { name: 'Close preview' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Preview pages')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Open here', exact: true })).toBeFocused()
  await page.waitForTimeout(450)
  await expect(page.locator('.link-preview')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Open in other pane', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.link-preview')).toHaveCount(0)
  await expect(link).toBeFocused()
  await page.waitForTimeout(450)
  await expect(page.locator('.link-preview')).toHaveCount(0)
  await page.keyboard.press('Tab') // Move off the source, then back to request another preview.
  await link.focus()
  await expect(page.locator('.link-preview')).toBeVisible()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab') // Last action in the preview.
  await expect(page.getByRole('button', { name: 'Open in other pane', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('.reader-pane')).toHaveCount(2)
  await expect(page.locator('.reader-pane').first().locator('.pdf-container')).toBeFocused()
  await expect(
    page.locator('.reader-pane').nth(1).getByRole('textbox', { name: 'Page number' }),
  ).toHaveValue('4')
})

test('long documents print past the former raster limit using one bounded canvas', async () => {
  test.setTimeout(120_000)
  await launch('long.pdf')
  await page.evaluate(() => {
    const create = document.createElement.bind(document)
    const state = window as unknown as { printCanvases: number; printMaxPixels: number }
    state.printCanvases = 0
    state.printMaxPixels = 0
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      if (tag === 'canvas' && new Error().stack?.includes('preparePrint')) state.printCanvases++
      return create(tag, options)
    }) as typeof document.createElement
    const toBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      if (new Error().stack?.includes('preparePrint')) {
        state.printMaxPixels = Math.max(state.printMaxPixels, this.width * this.height)
        if (this.width > 8192 || this.height > 8192 || this.width * this.height > 8_388_608)
          throw new Error('Print canvas exceeded its working surface limit')
      }
      toBlob.apply(this, args)
    }
    const decode = HTMLImageElement.prototype.decode
    HTMLImageElement.prototype.decode = function () {
      if (this.closest('#print-pages')) throw new Error('Print must not eagerly decode all pages')
      return decode.call(this)
    }
  })
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    const state = globalThis as unknown as { longPrint: { bytes: string | null; pages: number } }
    state.longPrint = { bytes: null, pages: 0 }
    contents.print = (_options, callback) => {
      void (async () => {
        state.longPrint.pages = await contents.executeJavaScript(
          'document.querySelectorAll("#print-pages .printed-page").length',
        )
        state.longPrint.bytes = (
          await contents.printToPDF({ printBackground: true, preferCSSPageSize: true })
        ).toString('base64')
        callback?.(true, '')
      })().catch((error) => callback?.(false, error.message))
    }
  })
  await page.getByRole('button', { name: 'Print paper', exact: true }).click()
  await expect
    .poll(
      () =>
        app.evaluate(
          () => (globalThis as unknown as { longPrint: { bytes: string | null } }).longPrint.bytes,
        ),
      { timeout: 100_000 },
    )
    .not.toBeNull()
  const result = await app.evaluate(
    () => (globalThis as unknown as { longPrint: { bytes: string; pages: number } }).longPrint,
  )
  expect(result.pages).toBe(120)
  expect((await PDFDocument.load(Buffer.from(result.bytes, 'base64'))).getPageCount()).toBe(120)
  expect(
    await page.evaluate(() => (window as unknown as { printCanvases: number }).printCanvases),
  ).toBe(1)
  expect(
    await page.evaluate(() => (window as unknown as { printMaxPixels: number }).printMaxPixels),
  ).toBeLessThanOrEqual(8_388_608)
  await expect(page.locator('#print-pages')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Prepare printing' })).toHaveCount(0)
})

test('large sheets print at full resolution in tiles with correct colours and dimensions', async () => {
  test.setTimeout(90_000)
  const { rgb, degrees } = await import('pdf-lib')
  const source = await PDFDocument.create()
  for (const rotation of [0, 90]) {
    const sheet = source.addPage([2384, 3370]) // A0, well above the old per-page pixel limit.
    sheet.setRotation(degrees(rotation))
    for (const [x, y, color] of [
      [0, 0, rgb(0.8, 0.1, 0.1)],
      [1192, 0, rgb(0.1, 0.7, 0.2)],
      [0, 1685, rgb(0.1, 0.2, 0.8)],
      [1192, 1685, rgb(0.8, 0.7, 0.1)],
    ] as const)
      sheet.drawRectangle({ x, y, width: 1192, height: 1685, color })
  }
  const bytes = await source.save()
  const directory = await mkdtemp(join(tmpdir(), 'margin-pdf-large-print-'))
  const filename = join(directory, 'large-sheets.pdf')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(filename, bytes)
  await launch(filename)
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    const state = globalThis as unknown as { tiledPrint: { bytes: string | null; tiles: number } }
    state.tiledPrint = { bytes: null, tiles: 0 }
    contents.print = (_options, callback) => {
      void (async () => {
        state.tiledPrint.tiles = await contents.executeJavaScript(
          'document.querySelectorAll("#print-pages img").length',
        )
        state.tiledPrint.bytes = (
          await contents.printToPDF({ printBackground: true, preferCSSPageSize: true })
        ).toString('base64')
        callback?.(true, '')
      })().catch((error) => callback?.(false, error.message))
    }
  })
  await page.getByRole('button', { name: 'Print paper', exact: true }).click()
  await expect
    .poll(
      () =>
        app.evaluate(
          () =>
            (globalThis as unknown as { tiledPrint: { bytes: string | null } }).tiledPrint.bytes,
        ),
      { timeout: 60_000 },
    )
    .not.toBeNull()
  const printed = await app.evaluate(
    () => (globalThis as unknown as { tiledPrint: { bytes: string; tiles: number } }).tiledPrint,
  )
  expect(printed.tiles).toBeGreaterThan(2)
  const output = Buffer.from(printed.bytes, 'base64')
  const pdf = await PDFDocument.load(output)
  expect(pdf.getPageCount()).toBe(2)
  expect(pdf.getPage(0).getWidth()).toBeCloseTo(2384, 0)
  expect(pdf.getPage(0).getHeight()).toBeCloseTo(3370, 0)
  expect(pdf.getPage(1).getWidth()).toBeCloseTo(3370, 0)
  expect(pdf.getPage(1).getHeight()).toBeCloseTo(2384, 0)
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createCanvas } = await import('@napi-rs/canvas')
  const originalTask = getDocument({ data: Uint8Array.from(bytes) })
  const actualTask = getDocument({ data: Uint8Array.from(output) })
  const original = await originalTask.promise
  const actual = await actualTask.promise
  try {
    for (let number = 1; number <= 2; number++) {
      const images: Uint8ClampedArray[] = []
      const reference = (await original.getPage(number)).getViewport({ scale: 0.1 })
      for (const document of [original, actual]) {
        const sheet = await document.getPage(number)
        const viewport = sheet.getViewport({ scale: 0.1 })
        // Chromium quantizes physical print sizes slightly. Use the source's
        // pixel grid so a sub-point difference cannot add an entire raster row.
        const canvas = createCanvas(Math.ceil(reference.width), Math.ceil(reference.height))
        await sheet.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise
        images.push(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data)
      }
      expect(images[0].length).toBe(images[1].length)
      const difference =
        images[0].reduce((sum, value, index) => sum + Math.abs(value - images[1][index]), 0) /
        images[0].length
      expect(difference).toBeLessThan(2)
    }
  } finally {
    await originalTask.destroy()
    await actualTask.destroy()
  }
  await expect(page.locator('#print-pages')).toHaveCount(0)
})

test('invalid physical page dimensions fail before allocating a print canvas', async () => {
  const oversized = await PDFDocument.create()
  oversized.addPage([20_000, 20_000])
  const directory = await mkdtemp(join(tmpdir(), 'margin-pdf-page-budget-'))
  const filename = join(directory, 'oversized.pdf')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(filename, await oversized.save())
  await launch(filename)
  await page.evaluate(() => {
    const create = document.createElement.bind(document)
    ;(window as unknown as { printCanvases: number }).printCanvases = 0
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      if (tag === 'canvas' && new Error().stack?.includes('preparePrint'))
        (window as unknown as { printCanvases: number }).printCanvases++
      return create(tag, options)
    }) as typeof document.createElement
  })
  await page.getByRole('button', { name: 'Print paper', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('invalid print dimensions')
  expect(
    await page.evaluate(() => (window as unknown as { printCanvases: number }).printCanvases),
  ).toBe(0)
  await expect(page.locator('#print-pages')).toHaveCount(0)
})

test('a crashed renderer offers native safe recovery and can open papers again', async () => {
  await launch('paper.pdf')
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(join(userData, 'reader-state.json'), 'utf8')).session.tabs.length,
    )
    .toBe(1)
  const recoveredWindow = app.waitForEvent('window')
  await app.evaluate(({ BrowserWindow, dialog }) => {
    ;(globalThis as unknown as { recoveryOffered: boolean }).recoveryOffered = false
    dialog.showMessageBox = (async (_window: unknown, options: Electron.MessageBoxOptions) => {
      ;(globalThis as unknown as { recoveryOffered: boolean }).recoveryOffered =
        !!options.buttons?.includes('Reopen safely')
      return { response: 0, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
    BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer()
  })
  page = await recoveredWindow
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('button', { name: 'Open sample PDF' })).toBeVisible()
  expect(
    await app.evaluate(
      () => (globalThis as unknown as { recoveryOffered: boolean }).recoveryOffered,
    ),
  ).toBe(true)
  await expect(page.getByRole('tab')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open sample PDF' }).click()
  await expect(page.locator('.reader-pane canvas').first()).toBeVisible()
})

test('a document render exception is contained and retry remounts the reader', async () => {
  await launch('paper.pdf')
  await page.getByRole('textbox', { name: 'Page number' }).fill('3')
  await page.getByRole('textbox', { name: 'Page number' }).press('Enter')
  await expect(page.getByRole('textbox', { name: 'Page number' })).toHaveValue('3')
  await page.locator('.document-tab').evaluate((element) => {
    type Fiber = { return: Fiber | null; memoizedProps?: { descriptor?: { location: string } } }
    const key = Object.keys(element).find((key) => key.startsWith('__reactFiber'))!
    let fiber = (element as unknown as Record<string, Fiber>)[key]
    while (!fiber.memoizedProps?.descriptor) fiber = fiber.return!
    const descriptor = fiber.memoizedProps.descriptor
    const location = descriptor.location
    Object.defineProperty(descriptor, 'location', {
      configurable: true,
      get() {
        throw new Error('Regression: document render failure')
      },
    })
    ;(window as unknown as { repairDocument: () => void }).repairDocument = () =>
      Object.defineProperty(descriptor, 'location', { configurable: true, value: location })
  })
  await page.getByRole('button', { name: 'Find in paper', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'This paper encountered a problem' }),
  ).toBeVisible()
  await expect(page.locator('.app-wordmark')).toBeVisible()
  await page.evaluate(() => (window as unknown as { repairDocument: () => void }).repairDocument())
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.locator('.reader-pane canvas').first()).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Page number' })).toHaveValue('3')
  errors = errors.filter(
    (error) =>
      !error.includes('Regression: document render failure') &&
      !error.includes('error occurred in the'),
  )
})

test('native tab switching cannot mix print jobs and the generated PDF contains only the intended document', async () => {
  await launch('scanned.pdf')
  await app.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] })
  }, resolve('tests/fixtures/paper.pdf'))
  await page.locator('.open-button').click()
  await expect(page.getByRole('tab', { name: 'Sample paper on PDF navigation' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.locator('.tab-panel:not([hidden]) canvas').first()).toBeVisible()
  await page.getByRole('tab', { name: 'Scanned document fixture' }).click()
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob
    let first = true
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      if (first) {
        first = false
        ;(window as unknown as { releasePrint: () => void }).releasePrint = () =>
          original.apply(this, args)
      } else original.apply(this, args)
    }
  })
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    const state = globalThis as unknown as {
      isolatedPrint: { calls: number; bytes: string | null; containers: string[] }
    }
    state.isolatedPrint = { calls: 0, bytes: null, containers: [] }
    contents.print = (_options, callback) => {
      state.isolatedPrint.calls++
      void (async () => {
        state.isolatedPrint.containers = await contents.executeJavaScript(
          'Array.from(document.querySelectorAll("#print-pages")).map(element => element.dataset.documentId)',
        )
        state.isolatedPrint.bytes = (
          await contents.printToPDF({ printBackground: true, preferCSSPageSize: true })
        ).toString('base64')
        callback?.(true, '')
      })().catch((error) => callback?.(false, error.message))
    }
  })
  await page.getByRole('button', { name: 'Print paper', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(() => typeof (window as unknown as { releasePrint?: () => void }).releasePrint),
    )
    .toBe('function')
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()!
      .items.find((item) => item.label === 'Window')!
      .submenu!.items.find((item) => item.label === 'Next tab')!
      .click()
  })
  await expect(page.getByRole('tab', { name: 'Sample paper on PDF navigation' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('dialog', { name: 'Prepare printing' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Print paper', exact: true })).toBeDisabled()
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()!
      .items.find((item) => item.label === 'File')!
      .submenu!.items.find((item) => item.label === 'Print…')!
      .click()
  })
  await expect(page.locator('#print-pages')).toHaveCount(1)
  await page.evaluate(() => (window as unknown as { releasePrint: () => void }).releasePrint())
  await expect
    .poll(
      () =>
        app.evaluate(
          () =>
            (globalThis as unknown as { isolatedPrint: { bytes: string | null } }).isolatedPrint
              .bytes,
        ),
      { timeout: 30_000 },
    )
    .not.toBeNull()
  const result = await app.evaluate(
    () =>
      (
        globalThis as unknown as {
          isolatedPrint: { calls: number; bytes: string; containers: string[] }
        }
      ).isolatedPrint,
  )
  expect(result.calls).toBe(1)
  expect(result.containers).toHaveLength(1)
  const snapshot = JSON.parse(await readFile(join(userData, 'reader-state.json'), 'utf8'))
  expect(result.containers[0]).toBe(
    snapshot.files.find((file: { path: string }) => file.path.endsWith('scanned.pdf')).id,
  )
  const output = Buffer.from(result.bytes, 'base64')
  expect((await PDFDocument.load(output)).getPageCount()).toBe(1)
  // Compare rendered output pixels to the selected source, not just DOM ownership/page counts.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createCanvas } = await import('@napi-rs/canvas')
  const raster = async (bytes: Uint8Array) => {
    const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true })
    const document = await task.promise
    try {
      const source = await document.getPage(1)
      const viewport = source.getViewport({ scale: 0.5 })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      await source.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise
      // Compare local averages to tolerate raster resampling in Chromium's PDF output.
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      const signature: number[] = []
      for (let y = 0; y + 8 <= canvas.height; y += 8)
        for (let x = 0; x + 8 <= canvas.width; x += 8) {
          let sum = 0
          for (let row = 0; row < 8; row++)
            for (let column = 0; column < 8; column++) {
              const offset = ((y + row) * canvas.width + x + column) * 4
              sum += (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3
            }
          signature.push(sum / 64)
        }
      return signature
    } finally {
      await task.destroy()
    }
  }
  const actual = await raster(output)
  const expected = await raster(await readFile(resolve('tests/fixtures/scanned.pdf')))
  expect(actual.length).toBe(expected.length)
  const meanDifference =
    actual.reduce((sum, value, index) => sum + Math.abs(value - expected[index]), 0) / actual.length
  const other = await raster(await readFile(resolve('tests/fixtures/paper.pdf')))
  const otherDifference =
    actual.reduce((sum, value, index) => sum + Math.abs(value - other[index]), 0) / actual.length
  expect(meanDifference).toBeLessThan(3)
  expect(meanDifference).toBeLessThan(otherDifference / 3)
  await expect(page.locator('#print-pages')).toHaveCount(0)
})

test('controls remain inside usable panes at minimum window size across layout, ratio, sidebar and search states', async () => {
  await launch('paper.pdf')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 560))
  await page.getByRole('button', { name: 'Toggle split view', exact: true }).click()
  for (const orientation of ['horizontal', 'vertical']) {
    if (orientation === 'vertical')
      await page.getByRole('button', { name: 'Stack panes vertically' }).click()
    for (const sidebar of [true, false]) {
      if (!sidebar) await page.getByRole('button', { name: 'Toggle sidebar' }).click()
      for (const search of [false, true]) {
        if (search) await page.getByRole('button', { name: 'Find in paper', exact: true }).click()
        await expect(page.locator('.pane-label')).toHaveCount(0)
        if (search) {
          for (const pane of await page.locator('.reader-pane').all()) {
            const box = await pane.boundingBox()
            const find = await pane.locator('.find-bar').boundingBox()
            expect(find!.width).toBeLessThanOrEqual(box!.width / 2 + 1)
            expect(Math.abs(find!.x + find!.width - box!.x - box!.width)).toBeLessThanOrEqual(1)
          }
        }
        for (const ratio of [20, 50, 80]) {
          const divider = page.getByRole('separator', { name: 'Resize panes' })
          await divider.focus()
          await divider.press('Home')
          for (let step = 0; step < Math.abs(ratio - 50) / 5; step++)
            await divider.press(ratio < 50 ? 'ArrowLeft' : 'ArrowRight')
          const clipped = await page.locator('.reader-pane').evaluateAll((panes) =>
            panes.flatMap((pane) => {
              const bounds = pane.getBoundingClientRect()
              return Array.from(
                pane.querySelectorAll<HTMLElement>(
                  '.pane-toolbar button, .pane-toolbar input, .pane-toolbar select, .find-bar button, .find-bar input',
                ),
              ).flatMap((control) => {
                const box = control.getBoundingClientRect()
                if (!box.width || !box.height)
                  return [control.getAttribute('aria-label') + ': hidden']
                return box.left < bounds.left - 1 ||
                  box.right > bounds.right + 1 ||
                  box.top < bounds.top - 1 ||
                  box.bottom > bounds.bottom + 1
                  ? [control.getAttribute('aria-label') + ': clipped']
                  : []
              })
            }),
          )
          expect(
            clipped,
            `${orientation}, sidebar=${sidebar}, search=${search}, ratio=${ratio}`,
          ).toEqual([])
        }
        if (search)
          await page
            .locator('.reader-pane')
            .first()
            .getByRole('button', { name: 'Close search' })
            .click()
      }
      if (!sidebar) await page.getByRole('button', { name: 'Toggle sidebar' }).click()
    }
  }
})

test('informative UI text meets AA contrast in both themes and interactive states', async () => {
  await launch('paper.pdf')
  const contrastFailures = () =>
    page.evaluate(() => {
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
      }
      return Array.from(
        document.querySelectorAll<HTMLElement>(
          '.outline-entry, .sidebar-header, .document-subtitle, .pane-label, .page-control, .status-bar, .theme-select, .preview-message, .preview-page, .preview-heading, .preview-footer button',
        ),
      ).flatMap((element) => {
        const style = getComputedStyle(element)
        let parent: HTMLElement | null = element
        let background = 'rgba(0, 0, 0, 0)'
        while (parent && background === 'rgba(0, 0, 0, 0)') {
          background = getComputedStyle(parent).backgroundColor
          parent = parent.parentElement
        }
        const a = luminance(style.color),
          b = luminance(background)
        const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        return contrast < 4.5
          ? [{ element: element.className, contrast, color: style.color, background }]
          : []
      })
    })
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'Colour theme' }).selectOption(theme)
    await page.waitForTimeout(200) // Allow foreground colour transitions to finish.
    const outline = page.locator('.outline-entry').first()
    for (const state of ['normal', 'hover', 'focus']) {
      if (state === 'hover') await outline.hover()
      if (state === 'focus') await outline.focus()
      expect(await contrastFailures(), `${theme} ${state}`).toEqual([])
    }
    await page.keyboard.press('Escape')
    await (await internalLink(page.locator('.reader-pane').first(), 5)).focus()
    await expect(page.locator('.preview-message')).toContainText('no available destination')
    expect(await contrastFailures(), `${theme} preview message`).toEqual([])
    await page.keyboard.press('Escape')
  }
})

test('production denies permission queries, external schemes and local WebSockets', async () => {
  await launch()
  const permissionStates = await page.evaluate(async () =>
    Promise.all(
      ['camera', 'geolocation', 'clipboard-read'].map(
        async (name) => (await navigator.permissions.query({ name: name as PermissionName })).state,
      ),
    ),
  )
  expect(permissionStates).toEqual(['denied', 'denied', 'denied'])
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,test',
    'ftp://example.org/paper.pdf',
  ]) {
    expect(
      await page.evaluate(async (url) => {
        try {
          await window.desktop.openExternal(url)
          return 'allowed'
        } catch (error) {
          return (error as Error).message
        }
      }, url),
    ).toContain('not supported')
  }
  const result = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const listener = (event: SecurityPolicyViolationEvent) => {
          if (event.effectiveDirective === 'connect-src') {
            document.removeEventListener('securitypolicyviolation', listener)
            resolve(event.blockedURI)
          }
        }
        document.addEventListener('securitypolicyviolation', listener)
        const socket = new WebSocket('ws://127.0.0.1:9')
        socket.onerror = () => socket.close()
      }),
  )
  expect(result).toContain('ws://127.0.0.1:9')
  // The intentional browser CSP diagnostic is expected; unrelated errors still fail teardown.
  errors = errors.filter((error) =>
    error.includes('Content Security Policy') ? !error.includes('127.0.0.1:9') : true,
  )
})

test('restoring many tabs loads only the selected document until another is visited', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'margin-pdf-background-'))
  const files: string[] = []
  for (let index = 0; index < 12; index++) {
    const file = join(directory, `background-${index}.pdf`)
    await copyFile(resolve('tests/fixtures/paper.pdf'), file)
    files.push(file)
  }
  await launch()
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files })
  }, files)
  await page.locator('.open-button').click()
  await expect(page.getByRole('tab')).toHaveCount(12)
  await expect(page.locator('.reader-pane')).toHaveCount(1)
  await app.close()
  await launch(undefined, userData)
  await expect(page.getByRole('tab')).toHaveCount(12)
  await expect(page.locator('.reader-pane')).toHaveCount(1)
  await page.locator('[role="tab"][title="background-0.pdf"]').click()
  await expect(page.locator('.tab-panel:not([hidden]) canvas').first()).toBeVisible()
  await expect(page.locator('.reader-pane')).toHaveCount(2)
})

test('safe startup skips document restoration while keeping saved positions available', async () => {
  await launch('paper.pdf')
  const input = page.getByRole('textbox', { name: 'Page number' })
  await input.fill('3')
  await input.press('Enter')
  await expect(input).toHaveValue('3')
  await app.close()
  await launch(undefined, userData, false, true)
  await expect(page.getByRole('button', { name: 'Open sample PDF' })).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(0)
  await page.locator('.recent-file').first().click()
  await expect(page.getByRole('textbox', { name: 'Page number' })).toHaveValue('3')
})
