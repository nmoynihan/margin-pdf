import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import electronPath from 'electron'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

let app: ElectronApplication
let profile: string
const flags = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []
async function launch(compact: boolean, files = ['paper.pdf']) {
  profile ??= await mkdtemp(join(tmpdir(), 'margin-compact-'))
  app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [
      ...flags,
      ...(process.env.MARGIN_PDF_HEADLESS === '1'
        ? ['--ozone-platform=headless']
        : process.env.MARGIN_PDF_OZONE_PLATFORM
          ? [`--ozone-platform=${process.env.MARGIN_PDF_OZONE_PLATFORM}`]
          : []),
      resolve('out/main/index.js'),
      ...(compact ? ['--compact'] : []),
      ...files.map((f) => resolve('tests/fixtures', f)),
    ],
    env: { ...process.env, MARGIN_PDF_USER_DATA: profile, ELECTRON_RENDERER_URL: '' },
  })
  const page = await app.firstWindow()
  await expect(page.locator('.reader-pane canvas').first()).toBeVisible()
  return page
}
test.afterEach(async () => {
  await app?.close().catch(() => {})
  if (profile) await rm(profile, { recursive: true, force: true })
  profile = ''
})

test('compact launch retains reader controls and document switching without changing saved layout', async () => {
  let page = await launch(true, ['paper.pdf', 'scanned.pdf'])
  await expect(page.locator('.app-shell')).toHaveAttribute('data-compact', 'true')
  await expect(page.locator('.app-header')).toBeHidden()
  await expect(page.locator('.tab-bar')).toBeHidden()
  const main = page.locator('.tab-panel:not([hidden])')
  await main.getByLabel('More reader actions').click()
  const switcher = main.getByLabel('Switch document')
  await expect(switcher.locator('option')).toHaveCount(2)
  await switcher.selectOption({ index: 0 })
  await expect(page.locator('.tab-panel:not([hidden]) .reader-pane canvas').first()).toBeVisible()
  await page.locator('.tab-panel:not([hidden])').getByLabel('More reader actions').click()
  await page
    .locator('.tab-panel:not([hidden])')
    .getByRole('button', { name: 'Use full layout' })
    .click()
  await expect(page.locator('.app-header')).toBeVisible()
  const layout = await page.evaluate(() =>
    window.desktop.bootstrap().then((boot) => boot.session.layout),
  )
  await page.evaluate(() => window.desktop.setCompact(true))
  expect(
    await app.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('compact-mode')!.checked,
    ),
  ).toBe(true)
  await expect(page.locator('.app-shell')).toHaveAttribute('data-compact', 'true')
  await app.close()
  const saved = JSON.parse(await readFile(join(profile, 'reader-state.json'), 'utf8'))
  expect(saved.session.layout).toEqual(layout)
  expect(saved.session).not.toHaveProperty('compact')
  page = await launch(false)
  await expect(page.locator('.app-header')).toBeVisible()
  await page.screenshot({ path: 'test-results/compact-desktop-restored.png' })
})

test('a second-instance compact launch changes the existing window and delivers its PDF', async () => {
  const page = await launch(false)
  await expect(page.locator('.app-header')).toBeVisible()
  await new Promise<void>((resolveLaunch, reject) => {
    const child = spawn(
      electronPath as unknown as string,
      [...flags, resolve('out/main/index.js'), '--compact', resolve('tests/fixtures/scanned.pdf')],
      {
        env: { ...process.env, MARGIN_PDF_USER_DATA: profile, ELECTRON_RENDERER_URL: '' },
        stdio: 'ignore',
      },
    )
    child.once('error', reject)
    child.once('exit', () => resolveLaunch())
  })
  await expect(page.locator('.app-shell')).toHaveAttribute('data-compact', 'true')
  await expect(page.locator('.app-header')).toBeHidden()
  await expect(page.locator('.tab-panel:not([hidden]) .reader-pane canvas').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/compact-desktop.png' })
})
