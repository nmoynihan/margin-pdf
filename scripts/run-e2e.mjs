import { spawn } from 'node:child_process'
const cli = [
  process.execPath,
  'node_modules/@playwright/test/cli.js',
  'test',
  ...process.argv.slice(2),
]
const headlessLinux = process.platform === 'linux' && !process.env.DISPLAY
const child = spawn(
  headlessLinux ? 'xvfb-run' : cli[0],
  headlessLinux ? ['-a', '-s', '-screen 0 1600x1200x24', ...cli] : cli.slice(1),
  { stdio: 'inherit', env: process.env },
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
