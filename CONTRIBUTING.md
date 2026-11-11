# Contributing to Margin PDF

Use [GitHub Issues](https://github.com/nmoynihan/margin-pdf/issues) for bugs and feature requests. Include the edition (desktop, Chrome or VS Code), OS, application/browser/editor version, reproduction steps and any error message. Share a small synthetic PDF that reproduces a problem when possible; keep private papers and credentials out of reports.

## Development

Node.js 24+ and npm are required. From the repository root:

```sh
npm ci
npm run dev
```

The React/PDF.js reader lives in `src/renderer/src`. Platform operations use `ReaderHost`; desktop, Chrome and VS Code implementations live in `src/renderer/src/desktop-host.ts`, `extensions/chrome/src` and `extensions/vscode/webview` respectively. Keep edition-specific controls and permissions in their platform integration.

## Checks

```sh
npm run format:check
npm run typecheck
npm test
npm run test:e2e
npm run test:chrome
npm run test:vscode
```

Linux desktop integration tests need a graphical session or Xvfb. Use `node scripts/run-e2e.mjs --x11` to test in an isolated X server. Chrome integration needs Chrome/Chromium 151+; set `MARGIN_CHROME_EXECUTABLE` when necessary. VS Code integration needs `pdflatex` and Xvfb on Linux. Each suite uses temporary profiles and generated fixtures.

## Source releases

Keep the versions in the root package, Chrome manifest and VS Code package synchronized. Update the changelogs, then run `npm run check:release`. Build artifacts and generated fixtures are excluded from Git; the build scripts recreate them from source and the lockfile.

The CI workflow builds and tests each edition. A version tag such as `v0.1.0` additionally assembles a draft GitHub Release with the packaged artifacts and checksums after all build jobs succeed. Review the draft before publishing it. Store submissions and AUR updates remain separate manual steps; the source-release workflow does not publish to those services.

For desktop signing and dependency maintenance, see [SECURITY.md](SECURITY.md).
