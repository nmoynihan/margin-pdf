import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PDFDocument } from 'pdf-lib'

const directory = resolve('extensions/chrome/dist')
const profile = await mkdtemp(join(tmpdir(), 'margin-chrome-test-'))
const results = resolve('test-results/chrome')
await mkdir(results, { recursive: true })
const paper = await readFile('tests/fixtures/paper.pdf')
const password = await readFile('tests/fixtures/password.pdf')
const requests = []
const errors = []
let singleUseRequests = 0
const server = createServer((request, response) => {
  requests.push({ url: request.url, method: request.method })
  if (request.url === '/post') {
    response.setHeader('content-type', 'text/html')
    response.end(
      '<form method="post" action="/post-document"><button>Read posted PDF</button></form>',
    )
    return
  }
  if (request.url === '/embed') {
    response.setHeader('content-type', 'text/html')
    response.end(
      '<iframe title="Embedded PDF" src="/embedded-document" style="width:100%;height:700px"></iframe>',
    )
    return
  }
  if (request.url === '/single-use' && ++singleUseRequests > 1) {
    response.writeHead(410)
    response.end('Expired')
    return
  }
  if (request.url === '/post-document' && request.method !== 'POST') {
    response.writeHead(405)
    response.end('POST required')
    return
  }
  response.setHeader('content-type', 'application/pdf')
  response.end(
    request.url === '/password'
      ? password
      : request.url === '/invalid'
        ? Buffer.from('not a PDF')
        : paper,
  )
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const executablePath =
  process.env.MARGIN_CHROME_EXECUTABLE ||
  (existsSync('/usr/sbin/chromium') ? '/usr/sbin/chromium' : undefined)
let context
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath,
    headless: true,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${directory}`,
      `--load-extension=${directory}`,
      '--no-sandbox',
    ],
  })
  const version = context.browser()?.version()
  assert(
    Number(version?.split('.')[0]) >= 151,
    `Chrome 151+ is required; found ${version}. Set MARGIN_CHROME_EXECUTABLE.`,
  )
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  const extensionOrigin = new URL(worker.url()).origin
  const extensionId = worker.url().split('/')[2]
  const base = `chrome-extension://${extensionId}`
  assert(
    await worker.evaluate(() => !!chrome.mimeHandler),
    'Public PDF MIME-handler API is unavailable.',
  )
  const newPage = async () => {
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('Invalid PDF'))
        errors.push(message.text())
    })
    return page
  }
  const readerFrame = async (page) => {
    await expect
      .poll(() => page.frames().some((frame) => frame.url().includes(`${extensionId}/viewer.html`)))
      .toBe(true)
    return page.frames().find((frame) => frame.url().includes(`${extensionId}/viewer.html`))
  }
  const visiblePdf = async (reader) => {
    await expect(reader.locator('.reader-pane canvas').first()).toBeVisible({ timeout: 20_000 })
    await expect(reader.locator('.document-title')).toContainText('Reading without losing')
  }
  const action = async (reader, name) => {
    const button = reader.getByRole('button', { name, exact: true })
    if (!(await button.isVisible()))
      await reader.getByLabel('More reader actions', { exact: true }).click()
    await button.click()
  }
  const settings = async (reader) => {
    await reader.getByRole('button', { name: 'Reader settings', exact: true }).click()
    return reader.getByRole('dialog', { name: 'Reader settings' })
  }

  const welcome = await newPage()
  await welcome.goto(`${base}/welcome.html`)
  await expect(welcome.getByRole('button', { name: 'Open a PDF', exact: true })).toBeEnabled()
  await welcome.screenshot({ path: join(results, 'store-welcome.png') })
  await welcome.getByRole('button', { name: 'Open sample PDF' }).click()
  await visiblePdf(welcome)
  console.log('PASS: offline bundled sample and welcome screen')

  const pdf = await newPage()
  await pdf.goto(`${origin}/document`)
  const reader = await readerFrame(pdf)
  await visiblePdf(reader)
  assert.equal(pdf.url(), `${origin}/document`)
  assert.equal(requests.filter((request) => request.url === '/document').length, 1)
  const link = reader.locator('.reader-pane .page[data-page-number="1"] .linkAnnotation a').first()
  await link.hover()
  await expect(reader.getByRole('dialog', { name: 'Link preview' })).toBeVisible()
  await expect(reader.locator('.preview-page')).toHaveText('Page 4')
  await expect(reader.locator('.preview-page-host canvas')).toBeVisible()
  await reader.locator('body').press('Escape')
  await link.click({ modifiers: ['Control'] })
  await expect(reader.locator('.reader-pane')).toHaveCount(2)
  await reader.locator('.reader-pane').nth(1).locator('.pdf-container').focus()
  await expect(reader.getByRole('textbox', { name: 'Page number' })).toHaveValue('4')
  await reader.locator('.reader-pane').first().locator('.pdf-container').focus()
  await expect(reader.getByRole('textbox', { name: 'Page number' })).toHaveValue('1')
  await expect(
    reader.locator('.browser-main .document-toolbar, .browser-main .pane-toolbar'),
  ).toHaveCount(0)
  await expect(
    reader.locator('.browser-header').getByRole('button', { name: 'Open PDF', exact: true }),
  ).toHaveCount(0)
  for (const width of [1280, 800, 420, 360]) {
    await pdf.setViewportSize({ width, height: 800 })
    const header = await reader.locator('.browser-header').boundingBox()
    assert(header.height <= 44, `Header must remain one row at ${width}px`)
    const clipped = await reader.locator('.browser-header').evaluate((header) => {
      const bounds = header.getBoundingClientRect()
      return [...header.querySelectorAll('button,input,select,summary')]
        .filter((control) => {
          if (control.closest('.reader-overflow-content')) return false
          const box = control.getBoundingClientRect()
          return (
            box.width &&
            box.height &&
            (box.left < bounds.left ||
              box.right > bounds.right + 1 ||
              box.bottom > bounds.bottom + 1)
          )
        })
        .map((control) => control.getAttribute('aria-label'))
    })
    assert.deepEqual(clipped, [], `Header controls must fit at ${width}px`)
  }
  await pdf.setViewportSize({ width: 1280, height: 800 })
  console.log(
    'PASS: one compact toolbar, active-pane controls, no Open PDF button and responsive layout',
  )
  await expect
    .poll(() =>
      reader
        .locator('.reader-pane canvas')
        .first()
        .evaluate((canvas) => canvas.width / canvas.getBoundingClientRect().width),
    )
    .toBeGreaterThanOrEqual(0.99)
  await pdf.screenshot({ path: join(results, 'store-reader.png') })
  await reader.getByRole('button', { name: 'Find in paper', exact: true }).click()
  const search = reader.locator('.active-pane .find-bar input').first()
  await search.fill('reference')
  await search.press('Enter')
  await expect(reader.locator('.active-pane .find-bar')).toContainText(/\d+ \/ \d+/)
  await reader.locator('.active-pane').getByRole('button', { name: 'Close search' }).click()
  console.log(
    'PASS: native MIME handler, unchanged URL, single fetch, preview, split panes and search',
  )

  const downloading = pdf.waitForEvent('download')
  await reader.getByRole('button', { name: 'Download PDF' }).click()
  const download = await downloading
  assert.deepEqual(await readFile(await download.path()), paper)
  console.log('PASS: download preserves original PDF bytes')

  const printPromise = pdf.waitForEvent('console', {
    predicate: (message) => message.text() === 'MARGIN_PRINT_READY',
  })
  await reader.evaluate(() => {
    window.print = () => {
      const pages = [...document.querySelectorAll('#print-pages .printed-page')]
      if (pages.length !== 5 || pages.some((page) => !page.querySelector('img')?.complete))
        throw new Error('Print pages were not fully prepared.')
      console.log('MARGIN_PRINT_READY')
    }
  })
  await action(reader, 'Print paper')
  await printPromise
  await expect(reader.locator('#print-pages')).toHaveCount(0)
  await expect(reader.getByRole('button', { name: 'Print paper', exact: true })).toBeFocused()
  console.log('PASS: complete print preparation and cleanup')

  const manyPages = await PDFDocument.create()
  for (let number = 1; number <= 301; number++) {
    const sheet = manyPages.addPage([144, 144])
    sheet.drawText(`Page ${number}`, { x: 10, y: 72, size: 12 })
  }
  const printingMany = await newPage()
  await printingMany.goto(`${base}/welcome.html`)
  await expect(printingMany.getByRole('button', { name: 'Open a PDF', exact: true })).toBeEnabled()
  await printingMany.getByLabel('Choose PDF file').setInputFiles({
    name: '301-pages.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await manyPages.save()),
  })
  await expect(printingMany.locator('.reader-pane canvas').first()).toBeVisible()
  const allPrinted = printingMany.waitForEvent('console', {
    predicate: (message) => message.text() === 'MARGIN_MANY_PRINT_READY',
    timeout: 60_000,
  })
  await printingMany.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode
    HTMLImageElement.prototype.decode = function () {
      if (this.closest('#print-pages')) throw new Error('Print requested eager image decoding')
      return decode.call(this)
    }
    window.print = () => {
      const pages = [...document.querySelectorAll('#print-pages .printed-page')]
      if (pages.length !== 301 || pages.some((page) => !page.querySelector('img')?.complete))
        throw new Error('Long print job did not prepare every page.')
      console.log('MARGIN_MANY_PRINT_READY')
    }
  })
  await action(printingMany, 'Print paper')
  await allPrinted
  await expect(printingMany.locator('#print-pages')).toHaveCount(0)
  await printingMany.close()
  console.log('PASS: all 301 pages print without a page-count cutoff or eager image decoding')

  assert.deepEqual(Object.keys(await worker.evaluate(() => chrome.storage.local.get(null))), [])
  const dialog = await settings(reader)
  await dialog.getByRole('combobox', { name: 'Colour theme' }).selectOption('dark')
  await dialog.getByRole('combobox', { name: 'Skin' }).selectOption('folio')
  await dialog.getByRole('checkbox', { name: 'Remember reading positions on this device' }).check()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  const activePage = reader.getByRole('textbox', { name: 'Page number' })
  await activePage.fill('3')
  await activePage.press('Enter')
  await expect
    .poll(
      async () =>
        Object.keys(await worker.evaluate(() => chrome.storage.local.get(null))).filter((key) =>
          key.startsWith('position:'),
        ).length,
    )
    .toBe(1)
  const saved = await worker.evaluate(() => chrome.storage.local.get(null))
  assert(!JSON.stringify(saved).includes(origin))
  const reopened = await newPage()
  await reopened.goto(`${origin}/another-document`)
  const again = await readerFrame(reopened)
  await visiblePdf(again)
  await expect(again.locator('.reader-pane')).toHaveCount(2)
  await expect(again.getByRole('textbox', { name: 'Page number' })).toHaveValue('3')
  await expect(again.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(again.locator('html')).toHaveAttribute('data-skin', 'folio')
  const againSettings = await settings(again)
  await againSettings
    .getByRole('checkbox', { name: 'Remember reading positions on this device' })
    .uncheck()
  await expect
    .poll(
      async () =>
        Object.keys(await worker.evaluate(() => chrome.storage.local.get(null))).filter((key) =>
          key.startsWith('position:'),
        ).length,
    )
    .toBe(0)
  await againSettings.getByRole('button', { name: 'Done', exact: true }).click()
  console.log('PASS: preferences, opt-in content-based position restore and history deletion')

  const posted = await newPage()
  await posted.goto(`${origin}/post`)
  await posted.getByRole('button', { name: 'Read posted PDF' }).click()
  await visiblePdf(await readerFrame(posted))
  assert.deepEqual(
    requests.filter((request) => request.url === '/post-document').map((request) => request.method),
    ['POST'],
  )
  const single = await newPage()
  await single.goto(`${origin}/single-use`)
  await visiblePdf(await readerFrame(single))
  assert.equal(singleUseRequests, 1)
  console.log('PASS: POST responses and single-use URLs require no second request')

  const embedded = await newPage()
  await embedded.goto(`${origin}/embed`)
  await visiblePdf(await readerFrame(embedded))
  const local = await newPage()
  await local.goto(pathToFileURL(resolve('tests/fixtures/paper.pdf')).href)
  await visiblePdf(await readerFrame(local))
  console.log('PASS: embedded documents and file:// PDFs without site-access permissions')

  const hash = await newPage()
  await hash.goto(`${origin}/fragment#page=3`)
  const hashReader = await readerFrame(hash)
  await visiblePdf(hashReader)
  await expect(hashReader.getByRole('textbox', { name: 'Page number' })).toHaveValue('3')
  const upload = await newPage()
  await upload.goto(`${base}/welcome.html`)
  await upload.getByLabel('Choose PDF file').setInputFiles('tests/fixtures/paper.pdf')
  await visiblePdf(upload)
  const dropped = await newPage()
  await dropped.goto(`${base}/welcome.html`)
  await expect(dropped.getByRole('button', { name: 'Open a PDF', exact: true })).toBeEnabled()
  const transfer = await dropped.evaluateHandle((bytes) => {
    const data = new DataTransfer()
    data.items.add(new File([new Uint8Array(bytes)], 'dropped.pdf', { type: 'application/pdf' }))
    return data
  }, Array.from(paper))
  await dropped.locator('.browser-reader').dispatchEvent('drop', { dataTransfer: transfer })
  await visiblePdf(dropped)
  await transfer.dispose()
  await dropped.setViewportSize({ width: 420, height: 700 })
  await expect
    .poll(() => dropped.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  console.log('PASS: page fragments, file picker, drag-and-drop and narrow layout')

  const locked = await newPage()
  await locked.goto(`${origin}/password`)
  const lockedReader = await readerFrame(locked)
  await lockedReader.getByLabel('PDF password', { exact: true }).fill('read')
  await lockedReader.getByRole('button', { name: 'Unlock paper', exact: true }).click()
  await expect(lockedReader.locator('.reader-pane canvas').first()).toBeVisible()
  const invalid = await newPage()
  await invalid.goto(`${origin}/invalid`)
  const invalidReader = await readerFrame(invalid)
  await expect(invalidReader.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
  await invalidReader.getByRole('button', { name: 'Chrome viewer', exact: true }).click()
  await expect
    .poll(() =>
      invalid.frames().some((frame) => frame.url().includes(`${extensionId}/viewer.html`)),
    )
    .toBe(false)
  console.log('PASS: password-protected PDFs, invalid input and native fallback')

  const offSettings = await settings(again)
  await offSettings.getByRole('checkbox', { name: 'Open PDFs in Margin PDF' }).uncheck()
  const native = await newPage()
  await native.goto(`${origin}/handling-disabled`)
  await expect
    .poll(() => native.frames().some((frame) => frame.url().includes('/index.html')))
    .toBe(true)
  assert(!native.frames().some((frame) => frame.url().includes(extensionId)))
  await offSettings.getByRole('checkbox', { name: 'Open PDFs in Margin PDF' }).check()
  console.log('PASS: automatic PDF handling can be disabled and re-enabled')

  // The package itself must remain self-contained and request only local storage.
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  assert.deepEqual(manifest.permissions, ['storage'])
  assert.equal(manifest.manifest_version, 3)
  assert(!manifest.host_permissions)
  assert(!manifest.content_scripts)
  assert.equal(manifest.mime_types_handler['application/pdf'].handler_url, 'viewer.html')
  assert.deepEqual(errors, [])
  await writeFile(
    join(results, 'verification.json'),
    JSON.stringify({ version, requests, errors, extensionOrigin }, null, 2),
  )
  await mkdir('dist/chrome-store', { recursive: true })
  for (const name of ['store-reader.png', 'store-welcome.png'])
    await copyFile(join(results, name), join('dist/chrome-store', name))
  console.log(`All Chrome integration checks passed (${version}). Screenshots: ${results}`)
} catch (error) {
  if (context) {
    for (const [index, page] of context.pages().entries()) {
      await page.screenshot({ path: join(results, `failure-${index}.png`) }).catch(() => {})
      await writeFile(
        join(results, `failure-${index}.txt`),
        page
          .frames()
          .map((frame) => frame.url())
          .join('\n'),
      )
    }
  }
  throw error
} finally {
  await context?.close()
  await new Promise((resolve) => server.close(resolve))
  await rm(profile, { recursive: true, force: true })
}
