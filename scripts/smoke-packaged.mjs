import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const candidates =
  process.platform === 'win32'
    ? ['dist/win-unpacked/PDF Junkie.exe']
    : process.platform === 'darwin'
      ? [
          `dist/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/PDF Junkie.app/Contents/MacOS/PDF Junkie`,
          'dist/mac/PDF Junkie.app/Contents/MacOS/PDF Junkie',
        ]
      : ['dist/linux-unpacked/pdf-junkie']
const executable = candidates.find(existsSync)
if (!executable) throw new Error('No packaged app found. Run the matching dist command first.')
const child = spawn(process.execPath, ['scripts/run-e2e.mjs', '--grep', 'packaged build'], {
  stdio: 'inherit',
  env: { ...process.env, PDF_JUNKIE_PACKAGED_EXECUTABLE: resolve(executable) },
})
child.on('exit', (code) => process.exit(code ?? 1))
child.on('error', (error) => {
  console.error(error.message)
  process.exit(1)
})
