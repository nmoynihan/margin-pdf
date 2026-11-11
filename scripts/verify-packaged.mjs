import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { chromium, expect } from '@playwright/test'
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses'

const executable = process.argv[2]
const wire = await getCurrentFuseWire(executable)
for (const name of [
  'RunAsNode',
  'EnableNodeOptionsEnvironmentVariable',
  'EnableNodeCliInspectArguments',
  'GrantFileProtocolExtraPrivileges',
])
  assert.equal(wire[FuseV1Options[name]], 48, `${name} must be disabled`)
for (const name of ['OnlyLoadAppFromAsar', 'EnableEmbeddedAsarIntegrityValidation'])
  assert.equal(wire[FuseV1Options[name]], 49, `${name} must be enabled`)
console.log('Packaged fuse inspection passed (ASAR integrity enforcement is platform dependent).')
const profile = await mkdtemp(join(tmpdir(), 'margin-pdf-packaged-'))
let browser
let diagnostics = ''
const child = spawn(
  executable,
  [
    '--remote-debugging-port=0',
    ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []),
  ],
  {
    env: {
      ...process.env,
      MARGIN_PDF_USER_DATA: profile,
      ELECTRON_RENDERER_URL: 'http://127.0.0.1:9/untrusted-override',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--this-must-be-ignored-by-the-packaged-binary',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`No packaged CDP endpoint: ${diagnostics}`)),
      20_000,
    )
    const read = (bytes) => {
      diagnostics += bytes.toString()
      const endpoint = diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1]
      if (endpoint) {
        clearTimeout(timer)
        resolve(endpoint)
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Packaged app exited ${code}: ${diagnostics}`))
    })
  })
  browser = await chromium.connectOverCDP(endpoint)
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent('page'))
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await expect(page.getByRole('region', { name: 'Open a PDF' })).toBeVisible()
  assert.equal(
    page.url(),
    'app://reader/index.html',
    'packaged development override must be ignored',
  )
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Open sample PDF' }).click()
  await expect(page.locator('.reader-pane canvas').first()).toBeVisible()
  const link = page.locator('.page[data-page-number="1"] .linkAnnotation a').first()
  await link.scrollIntoViewIfNeeded()
  await link.hover()
  await expect(page.locator('.preview-page-host canvas')).toBeVisible({ timeout: 12_000 })
  await page.keyboard.press('Escape')
  await link.click({ modifiers: ['Control'] })
  await expect(page.locator('.reader-pane')).toHaveCount(2)
  await expect(
    page.locator('.reader-pane').nth(1).getByRole('textbox', { name: 'Page number' }),
  ).toHaveValue('4')
  const workerURL = page
    .workers()
    .find((worker) => worker.url().includes('pdf.worker'))
    ?.url()
  assert.ok(workerURL?.startsWith('app://reader/'), 'a dedicated packaged worker must be running')
  const checks = await page.evaluate(
    async (workerURL) => ({
      node: typeof window.require,
      policy: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
      workerPolicy: (await fetch(workerURL)).headers.get('Content-Security-Policy'),
      camera: (await navigator.permissions.query({ name: 'camera' })).state,
    }),
    workerURL,
  )
  assert.equal(checks.node, 'undefined')
  assert.equal(checks.camera, 'denied')
  assert.match(checks.policy, /connect-src 'self';/)
  assert.match(checks.workerPolicy, /worker-src 'self';/)
  assert.doesNotMatch(checks.policy, /localhost|127\.0\.0\.1|ws:/)
  await expect
    .poll(
      async () =>
        JSON.parse(await readFile(join(profile, 'reader-state.json'), 'utf8')).session.tabs.length,
    )
    .toBe(1)
  assert.deepEqual(errors, [])
  console.log(
    'Packaged offline sample, worker CSP, permissions, split navigation, state and environment-override checks passed.',
  )
} finally {
  await browser?.close().catch(() => {})
  child.kill()
  if (child.exitCode === null)
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 3000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
