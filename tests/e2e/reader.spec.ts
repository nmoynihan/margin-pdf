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

async function launch(file?: string, directory?: string, fileURL = false) {
  userData = directory ?? (await mkdtemp(join(tmpdir(), 'pdf-junkie-e2e-')))
  errors = []
  app = await electron.launch({
    executablePath:
      process.env.PDF_JUNKIE_PACKAGED_EXECUTABLE ?? (electronPath as unknown as string),
    args: [
      ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []),
      ...(!process.env.PDF_JUNKIE_PACKAGED_EXECUTABLE ? [resolve('out/main/index.js')] : []),
      ...(file
        ? [
            fileURL
              ? pathToFileURL(resolve('tests/fixtures', file)).href
              : resolve('tests/fixtures', file),
          ]
        : []),
    ],
    env: { ...process.env, PDF_JUNKIE_USER_DATA: userData, ELECTRON_RENDERER_URL: '' },
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
  await expect(page.getByRole('heading', { name: 'Keep your place.' })).toBeVisible()
  await page.screenshot({ path: 'test-results/welcome.png' })
  await page.getByRole('button', { name: 'Explore with a sample paper' }).click()
  await expect(page.locator('.reader-pane canvas').first()).toBeVisible()
  await expect(page.locator('.document-title')).toHaveText('Reading without losing the thread')
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
    .toContain('PDF JUNKIE')
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
  await expect(page.getByRole('button', { name: 'Explore with a sample paper' })).toBeVisible()
})

test('OS file URLs with escaped spaces open as native PDF paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pdf-junkie file URL-'))
  const filename = join(directory, 'paper with spaces.pdf')
  await copyFile(resolve('tests/fixtures/paper.pdf'), filename)
  await launch(filename, undefined, true)
  await expect(page.locator('.document-title')).toHaveText('Reading without losing the thread')
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
  await expect(page.locator('.reader-pane canvas')).toBeVisible()
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
  await page.getByRole('tab', { name: 'Reading without losing the thread' }).click()
  await expect(
    page.locator('.tab-panel:not([hidden])').getByRole('textbox', { name: 'Page number' }),
  ).toHaveValue('3')
  await chooseFile('paper.pdf')
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

test('packaged build opens its sample and previews offline', async () => {
  test.skip(
    !process.env.PDF_JUNKIE_PACKAGED_EXECUTABLE,
    'Run npm run test:packaged after creating a distribution.',
  )
  await launch()
  await page.context().setOffline(true)
  await page.getByRole('button', { name: 'Explore with a sample paper' }).click()
  await expect(page.locator('.reader-pane canvas').first()).toBeVisible()
  const link = await internalLink()
  await link.hover()
  await expect(page.locator('.preview-page-host canvas')).toBeVisible()
  await page.keyboard.press('Escape')
  await link.click({ modifiers: ['Control'] })
  await expect(page.locator('.reader-pane')).toHaveCount(2)
  await expect(
    page.locator('.reader-pane').nth(1).getByRole('textbox', { name: 'Page number' }),
  ).toHaveValue('4')
})
