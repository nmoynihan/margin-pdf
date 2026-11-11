import { runTests } from '@vscode/test-electron'
import { build } from 'esbuild'
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createWriteStream } from 'node:fs'
import { existsSync } from 'node:fs'
import {
  PDFDocument,
  pushGraphicsState,
  popGraphicsState,
  translate,
  scale,
  drawObject,
} from 'pdf-lib'

if (process.platform === 'linux' && !process.env.MARGIN_VSCODE_XVFB) {
  const child = spawn(
    'xvfb-run',
    ['-a', '-s', '-screen 0 1600x1200x24', process.execPath, ...process.argv.slice(1)],
    { stdio: 'inherit', env: { ...process.env, MARGIN_VSCODE_XVFB: '1' } },
  )
  child.on('error', (error) => {
    console.error(error.message)
    process.exit(1)
  })
  child.on('exit', (code) => process.exit(code ?? 1))
} else {
  const scratch = await mkdtemp(join(tmpdir(), 'margin vscode '))
  try {
    const project = join(scratch, 'latex project')
    await cp('tests/fixtures/latex', project, { recursive: true })
    await mkdir(join(project, 'build output'))
    await mkdir(join(project, '.vscode'))
    await writeFile(
      join(project, '.vscode/settings.json'),
      JSON.stringify({
        'latex-workshop.latex.outDir': '%DIR%/build output',
        'workbench.startupEditor': 'none',
        'security.workspace.trust.enabled': false,
      }),
    )
    for (let i = 0; i < 2; i++)
      execFileSync(
        'pdflatex',
        [
          '-interaction=batchmode',
          '-halt-on-error',
          '-synctex=1',
          '-output-directory=build output',
          'main.tex',
        ],
        { cwd: project, stdio: 'pipe' },
      )
    // A tiny original JPEG2000 image exercises the bundled OpenJPEG WASM decoder.
    const codec = await PDFDocument.create()
    const page = codec.addPage([128, 128])
    const jpx = Buffer.from(
      'AAAADGpQICANCocKAAAAFGZ0eXBqcDIgAAAAAGpwMiAAAAAtanAyaAAAABZpaGRyAAAAIAAAACAAAwcHAAAAAAAPY29scgEAAAAAABAAAACzanAyY/9P/1EALwAAAAAAIAAAACAAAAAAAAAAAAAAACAAAAAgAAAAAAAAAAAAAwcBAQcBAQcBAf9SAAwAAAABAAUEBAAB/1wAE0BASEhQSEhQSEhQSEhQSEhQ/2QAJQABQ3JlYXRlZCBieSBPcGVuSlBFRyB2ZXJzaW9uIDIuNS40/5AACgAAAAAALAAB/5PPtAgDM8+0CAXvz7QICHmAgICAgICAgICAgICAgID/2Q==',
      'base64',
    )
    const image = codec.context.register(
      codec.context.stream(jpx, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: 32,
        Height: 32,
        ColorSpace: 'DeviceRGB',
        BitsPerComponent: 8,
        Filter: 'JPXDecode',
      }),
    )
    const name = page.node.newXObject('JpxFixture', image)
    page.pushOperators(
      pushGraphicsState(),
      translate(16, 16),
      scale(96, 96),
      drawObject(name),
      popGraphicsState(),
    )
    await writeFile(join(project, 'codec.pdf'), await codec.save())
    await mkdir('.vscode-test/results', { recursive: true })
    await cp(join(project, 'codec.pdf'), '.vscode-test/results/codec.pdf')
    await build({
      entryPoints: ['tests/vscode/suite.ts'],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      external: ['vscode'],
      outfile: '.vscode-test/results/suite.cjs',
    })
    const executable =
      process.env.VSCODE_EXECUTABLE_PATH ??
      (process.platform === 'linux' && existsSync('/usr/share/code/code')
        ? '/usr/share/code/code'
        : undefined)
    delete process.env.ELECTRON_RUN_AS_NODE
    delete process.env.VSCODE_IPC_HOOK_CLI
    const log = createWriteStream('.vscode-test/results/run.log')
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: resolve('extensions/vscode'),
      extensionTestsPath: resolve('.vscode-test/results/suite.cjs'),
      extensionTestsEnv: { MARGIN_TEST_PROJECT: project },
      stdout: log,
      stderr: log,
      launchArgs: [
        project,
        '--no-sandbox',
        '--disable-gpu',
        ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : []),
        ...(process.env.MARGIN_VSCODE_DEBUG_PORT
          ? [`--remote-debugging-port=${process.env.MARGIN_VSCODE_DEBUG_PORT}`]
          : []),
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        `--user-data-dir=${join(scratch, 'profile')}`,
        `--extensions-dir=${join(scratch, 'extensions')}`,
      ],
    })
    log.end()
    console.log('VS Code integration tests passed. Details: .vscode-test/results/run.log')
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
