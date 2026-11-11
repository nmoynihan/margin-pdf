import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const candidates =
  process.platform === 'win32'
    ? ['dist/win-unpacked/Margin PDF.exe']
    : process.platform === 'darwin'
      ? [
          `dist/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Margin PDF.app/Contents/MacOS/Margin PDF`,
          'dist/mac/Margin PDF.app/Contents/MacOS/Margin PDF',
        ]
      : ['dist/linux-unpacked/margin-pdf']
const executable = candidates.find(existsSync)
if (!executable) throw new Error('No packaged app found. Run the matching dist command first.')
// The hardened binary disables the Node inspector used by Playwright's Electron launcher.
// Test the real executable through Chromium CDP without weakening its fuses.
const headlessLinux = process.platform === 'linux' && !process.env.DISPLAY
const command = [process.execPath, 'scripts/verify-packaged.mjs', resolve(executable)]
const child = spawn(
  headlessLinux ? 'xvfb-run' : command[0],
  headlessLinux ? ['-a', ...command] : command.slice(1),
  { stdio: 'inherit', env: process.env },
)
child.on('exit', (code) => process.exit(code ?? 1))
child.on('error', (error) => {
  console.error(error.message)
  process.exit(1)
})
