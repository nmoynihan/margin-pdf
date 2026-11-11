# Margin PDF

A PDF reader for academic papers, with a desktop app, Chrome extension and VS Code editor. Built with React, TypeScript and Mozilla PDF.js; the desktop app uses Electron.

[Source and issues](https://github.com/nmoynihan/margin-pdf) · [Releases](https://github.com/nmoynihan/margin-pdf/releases) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)

Also available as a **Chrome extension** (Chrome 151+), sharing the same PDF reader and handling PDFs directly in browser tabs. Run `npm run dist:chrome` to create the Chrome Web Store upload ZIP, or see [Chrome installation and publishing](extensions/chrome/README.md). The desktop app does not need to be running.

The Chrome reader uses one compact toolbar containing the Margin PDF logo, page and zoom controls, the document title when there is room, sidebar, search and split-view controls. Select either pane to control its position and zoom from that bar. Ctrl/Cmd+Plus and Minus zoom the active PDF pane while the toolbar stays the same size. Printing and fullscreen are in **More reader actions**; local files can be opened from the welcome screen or with Ctrl/Cmd+O.

The [VS Code edition](extensions/vscode/README.md) adds local forward/reverse SyncTeX. Store and AUR listings are not yet published. GitHub version tags build draft releases for review; desktop CI installers are unsigned test builds.

The logo combines an open book, an **M**, and a vertical page margin in eucalyptus green and ivory. The [master artwork](resources/branding/margin-pdf-icon-master.png), [transparent mark](resources/branding/margin-pdf-mark.png), and [design prompts](resources/branding/design.json) live in `resources/branding/`. `npm run assets` exports the desktop PNG, Windows ICO, and macOS ICNS icons from the master.

Hover over an internal PDF link to read the target in a selectable, scrollable preview. **Ctrl+click** opens that target in a second pane without losing your reading position. Further Ctrl+clicks navigate the opposite pane, from either side. **Cmd+click** also works on macOS.

## Run locally

Requires Node.js **24 or later** and npm. No account, server, or API key is needed.

```sh
npm ci
npm run dev
```

The welcome screen includes a sample paper with bibliography, section, figure, and rotated-page links. Use **Open sample PDF** to try the interactions immediately. Open your own PDFs using the file picker, drag-and-drop, a command-line path, or the operating system’s **Open with** action.

To run the production build:

```sh
npm run build
npm start
# Or pass PDF paths directly:
npx electron . /absolute/path/to/paper.pdf
```

On Linux, Electron needs a graphical desktop and the usual Chromium libraries (`libgtk-3-0`, `libnss3`, `libasound2t64`, `libgbm1`). Use your distribution’s Electron/Chromium dependency equivalents if those package names differ. The application retains Electron’s renderer sandbox in normal use.

## Options

Open **Options** from the application controls or press **Ctrl+,** (**Cmd+,** on macOS). Choose **Appearance** for the skin browser and light, dark or system appearance. Changes preview immediately; **Save options** stores them and Cancel or Escape restores the saved settings.

Skins control colour, typography, corners and surface treatment. Changing a skin preserves the locations of controls and keeps the PDF views and reading positions intact.

| Skin     | Appearance                                             |
| -------- | ------------------------------------------------------ |
| Classic  | Eucalyptus, soft grey and understated sans serif type. |
| Folio    | Rust, warm paper, fine rules and editorial serif type. |
| Studio   | Cobalt, cool surfaces and bold sans serif type.        |
| Terminal | Amber, graphite, monospace type and square controls.   |
| Focus    | Violet, lavender and rounded controls.                 |

Under **Layout**, set the positions independently:

- Application controls (logo, Open PDF and Options): top, left or bottom.
- Document tabs: top, bottom, left or right.
- Sidebar: left, right or overlay.
- Document toolbar: top or bottom.
- Page controls: top or bottom.

The Standard, Editorial, Document rail, Command column and Reading dock presets provide starting arrangements. Any preset can be adjusted field by field and combined with any skin. Layout is saved independently of appearance. **Reset layout** restores the standard arrangement without changing the skin.

The engine uses the appearance registry in `src/renderer/src/skins.ts`, scoped style tokens in `skins.css`, placement rules in `layouts.css`, and validated preferences in the saved session. Everything is bundled locally and works offline.

## PDFs that change on disk

PDFs can be edited, rebuilt or replaced while open. The reader holds bytes in memory and closes its file handle after each read; it does not lock the source file for the reading session. It polls only open tabs, waits for two stable checks (normally about 1.4 seconds), and follows atomic replacement saves as well as in-place writes.

An active paper updates automatically, preserving each pane’s page, scroll position, zoom, rotation and split arrangement. If pages were removed, the page number is clamped to the last available page. Visited background tabs refresh when selected; unopened background tabs remain lazy. Updates wait until printing finishes. A refresh button in the document toolbar also reloads from disk.

The current PDF stays visible while its replacement parses. Incomplete saves retry briefly; invalid or temporarily missing files show a status message and retain the readable version. When the file returns or changes again, watching resumes automatically. Reloads share the document and memory admission budgets; if staging a replacement would exceed the byte limit, the current version stays open and the status message offers Retry.

## Reading

- Internal links preview after 300 ms. Move into the popup to scroll or select text; Escape dismisses it. Its buttons navigate the current pane or the opposite pane. Keyboard focus on an internal link also requests a preview. Press **Tab** or **Alt+Down** from the source to enter it. Tab cycles through its controls and scrollable page; Escape or Close returns focus to the source. Navigation returns focus to the reading pane.
- Two panes have independent positions, zoom, rotation, searches, and back/forward histories. Click a pane to make it active. The document sidebar acts on that pane.
- The PDF scrollbars have wide, visible thumbs; the pane divider has a dotted grip. Drag the divider to resize; double-click to reset it. A focused divider accepts arrow keys, with Home restoring an equal split. Toggle the layout to stack the panes vertically. Narrow workspaces stack automatically; resize limits reserve room for the toolbar and search controls. Your preferred layout is retained when room becomes available.
- Use the sidebar for the document outline or lazy-rendered page thumbnails. Collapse it from its header and reopen it from the narrow navigation rail or the document toolbar. Its collapsed state is retained. Each pane has page and zoom controls. Search includes match counts, previous/next matches, case sensitivity, and highlighting.
- Print prepares every PDF page before opening the native print dialog. One application-wide job owns the output, even when native menu commands switch tabs. Preparation can be cancelled with Cancel or Escape. The reader controls and split layout are excluded from the printed output.
- Light, dark, and system themes change the interface while preserving the PDF’s page colours.

### Shortcuts

| Action                    | Windows / Linux           | macOS                      |
| ------------------------- | ------------------------- | -------------------------- |
| Open PDFs                 | Ctrl+O                    | Cmd+O                      |
| Close tab                 | Ctrl+W                    | Cmd+W                      |
| Find                      | Ctrl+F                    | Cmd+F                      |
| Print                     | Ctrl+P                    | Cmd+P                      |
| Zoom in / out             | Ctrl+Plus / Ctrl+Minus    | Cmd+Plus / Cmd+Minus       |
| Fit width                 | Ctrl+0                    | Cmd+0                      |
| Rotate clockwise          | Ctrl+R                    | Cmd+R                      |
| Toggle split              | Ctrl+Backslash            | Cmd+Backslash              |
| Follow link in other pane | Ctrl+click                | Ctrl+click or Cmd+click    |
| Back / forward            | Alt+Left / Alt+Right      | Option+Left / Option+Right |
| Next / previous tab       | Ctrl+Tab / Ctrl+Shift+Tab | Ctrl+Tab / Ctrl+Shift+Tab  |

Zoom also accepts **Ctrl+=** without Shift and the numeric keypad’s **+ / −** keys.
On macOS, both **Ctrl** and **Cmd** work for these zoom shortcuts.

## Install on Omarchy / Arch Linux

The native x86_64 package installs **Margin PDF** in your application launcher with its icon and adds it to the PDF **Open with** menu. From this project directory, run the lowercase script with `./`:

```sh
./install.sh
```

The script installs npm dependencies if needed, builds the current app, checks the package, and then requests sudo for `pacman`. On Arch/Omarchy it also installs the packaging tool’s `libxcrypt-compat` dependency if missing. It works from another directory when invoked by its full path. Use `./install.sh --build-only` to prepare and verify the package without installing system packages. Run as your normal user; the script handles privilege elevation when needed.

To build and install manually:

```sh
npm run dist:arch
sudo pacman -U dist/margin-pdf-0.1.0-1-x86_64.pkg.tar.zst
```

If you already have the package, only the `pacman -U` step is needed; Node.js/npm are build requirements, not installation requirements. Pacman installs the required system libraries. Open your app launcher and search for **Margin PDF**, or run `margin-pdf`. The application bundles Electron, the PDF renderer and all reading assets for offline use.

To make it the default PDF reader, optionally run:

```sh
xdg-mime default margin-pdf.desktop application/pdf
```

Install later package versions with `sudo pacman -U <package-file>`; remove it with `sudo pacman -R margin-pdf`. Uninstalling retains your personal reading state. The `.deb` is for Debian/Ubuntu. The AppImage is portable and does not register the launcher/icon itself.

Installation, reinstallation, removal and shared-library resolution were verified in a clean Arch Linux container. The packaged launcher and icon pass automated checks; live Omarchy/Hyprland launcher behavior remains a local desktop check.

Building the Arch package requires `bsdtar`, `zstd`, and the `libcrypt.so.1` compatibility library used by electron-builder’s packaging tool. On Arch/Omarchy, install the build dependencies once with `sudo pacman -S --needed libarchive zstd libxcrypt-compat` (Debian/Ubuntu build hosts: `libarchive-tools zstd libcrypt1`). This local package uses the development release metadata described below.

## Build installers

```sh
npm run dist:linux  # x64 AppImage, .deb and Arch package
npm run dist:arch   # x64 Omarchy / Arch package only
npm run dist:win    # x64 NSIS installer
npm run dist:mac    # Intel and Apple Silicon DMGs
```

Outputs are written to `dist/`. Build on the matching operating system; macOS packaging requires macOS. The included GitHub Actions workflow runs tests and builds each platform’s installers, retaining them as workflow artifacts. It does not publish releases. Ordinary CI artifacts may be unsigned. The opt-in `npm run dist:release` profile requires code signing on Windows/macOS and enables macOS notarisation; credentials and real project metadata remain required. See [SECURITY.md](SECURITY.md) for exact release inputs, platform verification, and the security-update process. Updates are manual.

Development package metadata uses the reserved `margin-pdf.invalid` domain. Replace the homepage and maintainer email in `package.json` with the project’s real details before publishing packages.

## Checks

```sh
npm run typecheck
npm test
npm run format:check
npm run test:e2e
npm run test:packaged # after building installers; verifies the packaged reader offline
npm run test:arch-package # after dist:arch; checks the archive, launcher and icon
```

The Electron tests use real PDF.js rendering with generated fixtures: a linked academic-style sample, a 120-page document, a scanned image, invalid input, and a password-protected PDF. Fixtures and the sample are generated by `npm run assets`; the password test uses `read`.

For Chromium’s native headless backend, run `node scripts/run-e2e.mjs --native-headless`. Use `node scripts/run-e2e.mjs --x11` for an isolated Xvfb display, including on Wayland desktops. Otherwise, on a headless Linux host, `test:e2e` automatically runs through Xvfb. Install `xvfb` and `xauth` first. Only the automated Linux test launcher uses `--no-sandbox`, because CI/container hosts may disallow Chromium’s sandbox namespaces. Production window settings keep sandboxing enabled.

The tests cover hover previews, source preservation, bidirectional split navigation, search, thumbnails, rotation, lazy rendering, password retry, session restoration, print output isolation and pixels, history-clearing persistence/revocation, startup races, resource admission, renderer/component recovery, keyboard focus, responsive controls, contrast, and production security policies. Test screenshots and failure traces are written under `test-results/`. Physical printer dialogs and OS file-association installation should also be checked manually on each release platform.

## VS Code reader and compact desktop mode

The VS Code extension is built from the same React/PDF.js reader as the desktop app. It opens PDFs beside LaTeX source with hover previews, independent panes, automatic rebuild reloads, and bidirectional SyncTeX.

```sh
npm run dist:vscode
code --install-extension dist/margin-pdf-reader-0.1.0.vsix
```

In a LaTeX source file, run **Margin PDF: Open PDF Beside Source** or **Margin PDF: Sync PDF from Cursor**. Ctrl+click PDF content to reveal its source; Ctrl+click PDF links still opens the opposite pane. LaTeX Workshop continues to handle compilation. Build with `-synctex=1`. For ordinary PDFs, choose **Reopen Editor With… → Margin PDF**.

The extension uses a compact toolbar and VS Code themes. Reading state is saved in the VS Code workspace independently of desktop sessions. Initial support is for local desktop VS Code; remote workspaces are deferred. See [the extension guide](extensions/vscode/README.md) for associations, settings, optional keybindings, and development checks.

The desktop app also accepts `margin-pdf --compact paper.pdf`, including when an instance is already running. Use **View → Compact layout** or the reader's overflow menu to return to the full layout. Compact mode preserves the saved layout preferences; hidden document tabs remain accessible through the overflow menu's document switcher.

`npm run build` builds the desktop app; `npm run build:vscode` builds the extension; `npm run test:vscode` runs the real VS Code integration suite with a multi-file LaTeX fixture.

## Implementation

`src/main` owns native menus, file registration, scoped document handles, session storage, protocol serving, and desktop operations. `src/preload` exposes a typed bridge with specific operations rather than general IPC or filesystem access. `src/renderer` contains the React interface and adapters around PDF.js’s viewer, link, and find components. Both panes and previews share a loaded document; each full pane owns its own viewer and navigation state.

All rendering assets, including the PDF worker, character maps, standard fonts, ICC profiles, and WASM decoders, are packaged locally. PDF scripting is disabled. External HTTP, HTTPS, and mail links open only after a user click, through the OS.

Renderer crashes and unresponsive windows offer native recovery, including **Reopen safely** without restoring documents. **View → Reopen without restoring documents** or the `--safe-mode` command-line option also starts safely. Saved positions remain available when reopening a paper; recovery requires an explicit choice and does not loop through crashing documents. React failures have retry/close controls at document level and a reader-level safe-restart fallback.

Reading state is stored in `reader-state.json` in Electron’s platform-specific application-data directory. Open tabs, reading positions, split layouts, theme, and recent files are restored. Closing a tab retains its reading position for the next opening. **Clear recent** uses the current tab snapshot immediately, removes cleared file paths and handles, and keeps position memory keyed by an opaque ID. Cleared documents that are still open retain access until closed. Clearing history does not erase PDF bytes already loaded into a live document view. Passwords and modified PDF contents are never saved. Files are read from their existing location and are not copied into a managed library.

### Resource budgets

Files larger than **128 MiB** are rejected before reading. Native reads and PDF parsing each run at most **two** jobs concurrently. Unvisited background tabs do not parse PDFs; at most **eight** visited documents and **256 MiB** of PDF input are retained. Close a paper and retry when the admission budget is full. Reads check the open file's size again and read only the checked length, so a growing file cannot trigger an unbounded read. The IPC/PDF.js path avoids redundant typed-array copies; it still reads accepted files into memory rather than streaming them.

Print preparation has **no page-count or combined raster-area cutoff**. It uses one reusable canvas and retains completed pages as compressed PNG tiles, allowing Chromium to manage image decoding for printing. Each tile is limited to **8,388,608 pixels** (32 MiB raw RGBA) and **8192 pixels per dimension**. Large sheets use multiple tiles at the same **150 DPI**, preserving page dimensions, rotation and colours. Physical page boxes are checked before rendering; non-finite, zero, negative or dimensions over 200 inches per side are rejected. Cancellation releases the scratch canvas, images and blob URLs. Normal viewing and previews also bound canvas dimensions; thumbnails bound area and dimensions. These policies bound the working canvas, not total application memory, compressed print data, browser caches or the complexity of PDF content.

## Current boundaries

Previews follow destinations actually embedded in the PDF. A page-only link previews the page from the top; a broken target reports that it is unavailable. Unlinked citations, scanned-text search/OCR, online paper lookup, annotation editing, cloud sync, and bibliography management are outside this version.

The bundled sample is an original demonstration document; its citations and chart data are explicitly illustrative. PDF.js is distributed under the Apache 2.0 licence, included with its bundled assets. Electron and other dependencies retain their own licences. Application source is MIT licensed.
