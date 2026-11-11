import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import electronPath from 'electron'
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { PDFDocument, StandardFonts } from 'pdf-lib'

let app: ElectronApplication
let page: Page
let profile: string
let directory: string
let errors: string[]
const names = ['Classic', 'Folio', 'Studio', 'Terminal', 'Focus']
async function launch(path?: string, existingProfile?: string) {
  profile = existingProfile ?? (await mkdtemp(join(tmpdir(), 'margin-skin-e2e-')))
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
      ...(path ? [path] : []),
    ],
    env: { ...process.env, MARGIN_PDF_USER_DATA: profile, ELECTRON_RENDERER_URL: '' },
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await expect(page.locator('.app-wordmark')).toBeVisible()
  await expect(page.locator('.boot-screen')).toHaveCount(0)
  if (path) await expect(page.locator('.reader-pane canvas').first()).toBeVisible()
  else await expect(page.locator('.home-open, .reader-pane canvas').first()).toBeVisible()
}
async function chooseSkin(name: string) {
  await page.getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByRole('button', { name: `Preview ${name}`, exact: true }).click()
  await page.getByRole('button', { name: 'Save options', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-skin', name.toLowerCase())
}
async function paper(title: string, pages = 3) {
  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let number = 1; number <= pages; number++) {
    const p = pdf.addPage([612, 792])
    p.drawText(`${title} / page ${number}`, { x: 60, y: 700, font, size: 22 })
    p.drawText('A live document keeps your place while the source changes.', {
      x: 60,
      y: 650,
      font,
      size: 12,
    })
  }
  return pdf.save()
}

test.afterEach(async () => {
  await app?.close().catch(() => {})
  if (directory) {
    await rm(directory, { recursive: true, force: true })
    directory = ''
  }
  expect(errors ?? []).toEqual([])
})

test('skin browser previews, cancels, applies and restores all five appearances independently of layout', async () => {
  await launch()
  for (const name of names) {
    await chooseSkin(name)
    await page.screenshot({ path: `test-results/skins/${name.toLowerCase()}-welcome.png` })
  }
  await page.getByRole('button', { name: 'Options', exact: true }).click()
  await expect(page.locator('.skin-card')).toHaveCount(5)
  await page.getByRole('button', { name: 'Preview Folio', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'folio')
  await page.keyboard.press('Escape')
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'focus')
  await chooseSkin('Studio')
  await expect
    .poll(async () => {
      try {
        return JSON.parse(await readFile(join(profile, 'reader-state.json'), 'utf8')).session.skin
      } catch (error) {
        // The first save is debounced; a fresh profile may not have a state file yet.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    })
    .toBe('studio')
  const saved = profile
  await app.close()
  await launch(undefined, saved)
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'studio')
})

test('all skins retain the same PDF views and fit a narrow split workspace in light and dark', async () => {
  await launch(resolve('tests/fixtures/paper.pdf'))
  // Keep the outline available, but hidden for the split-canvas size assertions.
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click()
  await page.getByRole('button', { name: 'Toggle split view', exact: true }).click()
  const first = page.locator('.reader-pane').first()
  await first.getByRole('textbox', { name: 'Page number', exact: true }).fill('2')
  await first.getByRole('textbox', { name: 'Page number', exact: true }).press('Enter')
  const canvasIdentity = await first.locator('.pdfViewer').evaluate((element) => {
    element.setAttribute('data-skin-test', 'same-view')
    return 'same-view'
  })
  for (const name of names) {
    await chooseSkin(name)
    await expect(first.locator('.pdfViewer')).toHaveAttribute('data-skin-test', canvasIdentity)
    await expect(first.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('2')
    for (const theme of ['light', 'dark']) {
      await page.getByRole('combobox', { name: 'Colour theme' }).selectOption(theme)
      await page.setViewportSize({ width: 760, height: 600 })
      await expect(page.locator('.reader-pane canvas').first()).toBeVisible()
      const sizes = await page
        .locator('.app-header, .app-main, .reader-pane, .pane-toolbar')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const b = element.getBoundingClientRect()
            return { left: b.left, right: b.right, width: b.width, top: b.top, bottom: b.bottom }
          }),
        )
      for (const box of sizes) {
        expect(box.left).toBeGreaterThanOrEqual(-1)
        expect(box.right).toBeLessThanOrEqual(761)
        expect(box.top).toBeGreaterThanOrEqual(-1)
        expect(box.bottom).toBeLessThanOrEqual(601)
        expect(box.width).toBeGreaterThan(0)
      }
      await page.screenshot({
        path: `test-results/skins/${name.toLowerCase()}-${theme}-narrow.png`,
      })
    }
    await page.setViewportSize({ width: 1380, height: 920 })
    await page.screenshot({ path: `test-results/skins/${name.toLowerCase()}-reader.png` })
  }
})

test('PDF updates preserve both panes, survive incomplete saves and detect atomic replacement', async () => {
  directory = await mkdtemp(join(tmpdir(), 'margin-live-pdf-'))
  const path = join(directory, 'live.pdf')
  await writeFile(path, await paper('Original version'))
  await launch(path)
  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click()
  await page.getByRole('button', { name: 'Toggle split view', exact: true }).click()
  const first = page.locator('.reader-pane').first(),
    second = page.locator('.reader-pane').nth(1)
  for (const [pane, number] of [
    [first, '2'],
    [second, '3'],
  ] as const) {
    await pane.getByRole('textbox', { name: 'Page number', exact: true }).fill(number)
    await pane.getByRole('textbox', { name: 'Page number', exact: true }).press('Enter')
  }
  await first.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('page-fit')
  await writeFile(path, await paper('Updated version'))
  await expect(page.locator('.document-title')).toHaveText('Updated version', { timeout: 15000 })
  await expect(first.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('2')
  await expect(second.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('3')
  await expect(first.getByRole('combobox', { name: 'Zoom', exact: true })).toHaveValue('page-fit')
  await writeFile(path, '%PDF-incomplete-write')
  await expect(page.locator('.file-update-banner')).toContainText('Keeping the current PDF', {
    timeout: 15000,
  })
  await expect(page.locator('.document-title')).toHaveText('Updated version')
  await expect(first.locator('canvas').first()).toBeVisible()
  const replacement = join(directory, 'next.pdf')
  await writeFile(replacement, await paper('Atomic replacement', 2))
  await rename(replacement, path)
  await expect(page.locator('.document-title')).toHaveText('Atomic replacement', { timeout: 15000 })
  await expect(second.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('2')
  await rm(path)
  await expect(page.locator('.file-update-banner')).toContainText('temporarily unavailable')
  await expect(page.locator('.document-title')).toHaveText('Atomic replacement')
  await writeFile(path, await paper('File returned'))
  await expect(page.locator('.document-title')).toHaveText('File returned', { timeout: 15000 })
})

test('disk updates wait for the print job to finish', async () => {
  directory = await mkdtemp(join(tmpdir(), 'margin-live-print-'))
  const path = join(directory, 'printing.pdf')
  await writeFile(path, await paper('Printed version', 1))
  await launch(path)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.print = (_options, callback) => {
      ;(globalThis as any).finishTestPrint = callback
    }
  })
  await page.evaluate(() =>
    window.desktop.onDocumentChanged(() => {
      document.body.dataset.testFileChange = 'received'
    }),
  )
  await page.getByRole('button', { name: 'Print paper', exact: true }).click()
  await expect
    .poll(() => app.evaluate(() => typeof (globalThis as any).finishTestPrint))
    .toBe('function')
  await writeFile(path, await paper('Version after printing', 1))
  await expect(page.locator('body')).toHaveAttribute('data-test-file-change', 'received')
  await expect(page.locator('.document-title')).toHaveText('Printed version')
  await app.evaluate(() => (globalThis as any).finishTestPrint(true))
  await expect(page.locator('.document-title')).toHaveText('Version after printing', {
    timeout: 15000,
  })
})

test('a changed background document refreshes when selected and manual reload remains available', async () => {
  directory = await mkdtemp(join(tmpdir(), 'margin-background-reload-'))
  const firstPath = join(directory, 'first.pdf'),
    secondPath = join(directory, 'second.pdf')
  await writeFile(firstPath, await paper('First original', 1))
  await writeFile(secondPath, await paper('Second original', 1))
  await launch(firstPath)
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, secondPath)
  await page.locator('.open-button').click()
  await expect(page.locator('.tab-panel:not([hidden]) .document-title')).toHaveText(
    'Second original',
  )
  await page.evaluate(() =>
    window.desktop.onDocumentChanged(() => {
      document.body.dataset.testFileChange = 'received'
    }),
  )
  await writeFile(firstPath, await paper('First changed in background', 1))
  await expect(page.locator('body')).toHaveAttribute('data-test-file-change', 'received')
  await expect(page.locator('.tab-panel[hidden] .document-title')).toHaveText('First original')
  await page.getByRole('tab', { name: 'First original' }).click()
  await expect(page.locator('.tab-panel:not([hidden]) .document-title')).toHaveText(
    'First changed in background',
  )
  await page.getByRole('button', { name: 'Reload PDF from disk', exact: true }).click()
  await expect(page.locator('.tab-panel:not([hidden]) .file-update-banner')).toContainText(
    'Updated from disk',
  )
  await expect(page.locator('.tab-panel:not([hidden]) canvas').first()).toBeVisible()
})

async function setLayout(values: Record<string, string>) {
  await page.getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  for (const [label, value] of Object.entries(values))
    await page.getByRole('combobox', { name: label, exact: true }).selectOption(value)
  await page.getByRole('button', { name: 'Save options', exact: true }).click()
}

test('workspace positions are independent, survive skin changes and restore after restart', async () => {
  await launch(resolve('tests/fixtures/paper.pdf'))
  await page.setViewportSize({ width: 1380, height: 920 })
  await page.getByRole('textbox', { name: 'Page number' }).fill('2')
  await page.getByRole('textbox', { name: 'Page number' }).press('Enter')
  await setLayout({
    'Application controls': 'left',
    'Document tabs': 'right',
    'Sidebar position': 'right',
    'Document toolbar': 'bottom',
    'Page controls': 'bottom',
  })
  const positions = async () =>
    page
      .locator('.app-header, .tab-bar, .app-main, .sidebar, .document-toolbar, .pane-toolbar')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const b = element.getBoundingClientRect()
          return { className: element.className, x: b.x, y: b.y, width: b.width, height: b.height }
        }),
      )
  const original = await positions()
  for (const name of names) {
    await chooseSkin(name)
    const next = await positions()
    expect(next).toEqual(original)
    await expect(page.getByRole('textbox', { name: 'Page number' })).toHaveValue('2')
  }
  await page.getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page.getByRole('combobox', { name: 'Document tabs', exact: true }).selectOption('left')
  await page.keyboard.press('Escape')
  await expect(page.locator('html')).toHaveAttribute('data-tabs-position', 'right')
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(join(profile, 'reader-state.json'), 'utf8')).session.layout.tabs,
    )
    .toBe('right')
  const saved = profile
  await app.close()
  await launch(undefined, saved)
  await expect(page.locator('html')).toHaveAttribute('data-controls-position', 'left')
  await expect(page.locator('html')).toHaveAttribute('data-tabs-position', 'right')
  await expect(page.locator('html')).toHaveAttribute('data-sidebar-position', 'right')
  await expect(page.getByRole('textbox', { name: 'Page number' })).toHaveValue('2')
})

test('all control-bar and tab positions fit a narrow window', async () => {
  await launch(resolve('tests/fixtures/paper.pdf'))
  await page.setViewportSize({ width: 760, height: 600 })
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  for (const controls of ['top', 'left', 'bottom'])
    for (const tabs of ['top', 'bottom', 'left', 'right']) {
      await setLayout({ 'Application controls': controls, 'Document tabs': tabs })
      const boxes = await page
        .locator(
          '.app-header,.tab-bar,.app-main,.document-toolbar,.pane-toolbar,.options-button,.open-button',
        )
        .evaluateAll((elements) =>
          elements.map((element) => {
            const r = element.getBoundingClientRect()
            return {
              name: element.className,
              left: r.left,
              right: r.right,
              top: r.top,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            }
          }),
        )
      for (const box of boxes) {
        expect(box.left, `${controls}/${tabs} ${box.name}`).toBeGreaterThanOrEqual(-1)
        expect(box.right, `${controls}/${tabs} ${box.name}`).toBeLessThanOrEqual(761)
        expect(box.top, `${controls}/${tabs} ${box.name}`).toBeGreaterThanOrEqual(-1)
        expect(box.bottom, `${controls}/${tabs} ${box.name}`).toBeLessThanOrEqual(601)
        expect(box.width).toBeGreaterThan(0)
      }
    }
  await page.screenshot({ path: 'test-results/options/custom-layout.png' })
})

test('sidebar collapses from its header and reopens with the selected navigation mode', async () => {
  await launch(resolve('tests/fixtures/paper.pdf'))
  await page.getByRole('button', { name: 'Page thumbnails', exact: true }).click()
  await expect(page.locator('.thumbnail').first()).toBeVisible()
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click()
  await expect(page.locator('.thumbnail').first()).toBeVisible()
  await setLayout({ 'Sidebar position': 'right' })
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  const rail = await page.locator('.sidebar-collapsed').boundingBox()
  const reader = await page.locator('.split-area').boundingBox()
  expect(rail!.x).toBeGreaterThanOrEqual(reader!.x + reader!.width - 1)
  const saved = profile
  await app.close()
  await launch(undefined, saved)
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeVisible()
})

test('opening screen is minimal and scrollbars are distinct from the resize grip', async () => {
  await launch()
  for (const text of [
    'MADE FOR DEEP READING',
    'Keep your place.',
    'Follow the reference.',
    'A reference, within reach.',
    'Two places. One paper.',
  ])
    await expect(page.getByText(text, { exact: true })).toHaveCount(0)
  await expect(page.locator('.feature-card')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/options/minimal-home.png' })
  await page.getByRole('button', { name: 'Options', exact: true }).click()
  await page.screenshot({ path: 'test-results/options/appearance.png' })
  await page.getByRole('tab', { name: 'Layout', exact: true }).click()
  await page.screenshot({ path: 'test-results/options/layout.png' })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Open sample PDF', exact: true }).click()
  await expect(page.locator('.reader-pane canvas').first()).toBeVisible()
  await page.setViewportSize({ width: 1380, height: 920 })
  await page.getByRole('button', { name: 'Toggle split view', exact: true }).click()
  const scroll = await page
    .locator('.pdf-container')
    .first()
    .evaluate((element) => ({
      width: getComputedStyle(element, '::-webkit-scrollbar').width,
      color: getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor,
      minimum: getComputedStyle(element, '::-webkit-scrollbar-thumb').minHeight,
    }))
  expect(scroll.width).toBe('14px')
  expect(scroll.minimum).toBe('48px')
  expect(scroll.color).not.toBe('rgba(0, 0, 0, 0)')
  const divider = page.getByRole('separator', { name: 'Resize panes' })
  await expect(divider).toHaveAttribute('title', /Drag to resize/)
  expect(
    await divider.locator('span').evaluate((element) => getComputedStyle(element).backgroundImage),
  ).toContain('radial-gradient')
  await divider.focus()
  await divider.press('ArrowRight')
  await expect(divider).not.toHaveAttribute('aria-valuenow', '50')
  await page.screenshot({ path: 'test-results/options/scrollbars-and-divider.png' })
})
