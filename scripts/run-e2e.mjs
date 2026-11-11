import { spawn } from 'node:child_process'
const nativeHeadless = process.argv.includes('--native-headless')
const x11 = process.argv.includes('--x11')
const cli = [
  process.execPath,
  'node_modules/@playwright/test/cli.js',
  'test',
  ...process.argv
    .slice(2)
    .filter((argument) => argument !== '--native-headless' && argument !== '--x11'),
]
const headlessLinux =
  process.platform === 'linux' && (x11 || !process.env.DISPLAY) && !nativeHeadless
const child = spawn(
  headlessLinux ? 'xvfb-run' : cli[0],
  headlessLinux ? ['-a', '-s', '-screen 0 1600x1200x24', ...cli] : cli.slice(1),
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(nativeHeadless ? { MARGIN_PDF_HEADLESS: '1' } : {}),
      ...(headlessLinux ? { MARGIN_PDF_OZONE_PLATFORM: 'x11' } : {}),
    },
  },
)
child.on('error', (error) => {
  console.error(
    headlessLinux
      ? 'Electron tests need Xvfb on Linux without a display. Install xvfb and xauth, then retry.'
      : error.message,
  )
  process.exit(1)
})
child.on('exit', (code) => process.exit(code ?? 1))
