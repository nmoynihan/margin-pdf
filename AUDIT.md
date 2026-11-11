# Margin PDF security, quality, and product audit

Date: 29 October 2026

Source reviewed: `255839d7c12f04774bc9876cbc316394affb3d29`

Environment: Linux, Node 26.12.1; Electron 45.1.0 / Chromium 156.0.8078.49

## Remediation status — 29 October 2026

All eight findings were rechecked against the working source and fixed. The original findings below remain as historical reproduction evidence; their line numbers refer to the audited revision. Release signing/notarisation is **prepared, externally blocked**, not complete.

Printing update — 10 November 2026: the former 250-page and 256 MiB cumulative raster cutoffs described in this audit have been replaced. Print preparation now reuses one bounded canvas, retains compressed image tiles, and leaves decoding to Chromium. Large sheets use multiple tiles at 150 DPI. Current limits and verification are documented in README; the earlier audit evidence below records the previous implementation.

| Finding                 | Remediation                                                                                                                                                                                                                                                                                           | Regression evidence                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Print isolation     | App-owned synchronous lock, global progress/cancellation, native re-entry guard and ownership-checked single print container. Closing the source waits for completion/cancellation.                                                                                                                   | Electron native-menu tab-switch/re-entry test asserts one job/container, creates an actual PDF, checks its document identity/page count and compares raster signatures with the intended source and a different open PDF. Existing five-page/rotated-page output and cancellation checks retained.                                                                                                             |
| 2 — Clear recent        | Snapshot and clearing are one native operation. Path records and handles are removed when neither open nor retained in history; zero-timestamp records are pruned on close. Opaque-ID position memory is separate.                                                                                    | Unit tests inspect disk and live/restarted handle rejection, including queued prior saves and clear-while-open then close. Electron UI closes the final tab and clears before the 350 ms debounce, then checks disk and access after the following save.                                                                                                                                                       |
| 3 — Bootstrap opens     | Native opens remain queued until a renderer acknowledgement after restoration is committed. The queue drains serially, including new arrivals; restoration merges rather than overwrites newer tabs.                                                                                                  | Electron tests inject OS opens synchronously during awaited native registration and delayed session reopening, asserting every requested PDF appears exactly once.                                                                                                                                                                                                                                             |
| 4 — Resource budgets    | 128 MiB/file, two reads/parses at once, lazy unvisited tabs, eight retained documents/256 MiB input. Checked-length reads, no redundant typed-array copies. Print preflight caps page count, dimensions, per-page and cumulative pixels before canvases. Thumbnail/view/preview canvases have limits. | Sparse-file growth/registration unit tests; mocked-parser concurrency, cancellation, retained-count/byte admission without large allocations; 12-tab restoration test; actual oversized PDF and 120-page cumulative print rejection with zero print canvas allocations, guarded against unsafe allocations and checked against a successful small-print positive control. See README for budgets and fallback. |
| 5 — Recovery            | Native crash/unresponsive choices; safe startup via CLI/menu; fresh window on crash recovery; document and application React boundaries. No automatic document reload loop.                                                                                                                           | Actual renderer crash with native safe-choice stub creates a new usable reader and reopens a sample. Actual document render exception is caught and retried without losing the current reading position. Safe CLI startup retains saved positions on reopening.                                                                                                                                                |
| 6 — Keyboard previews   | Tab/Alt+Down enters the popup; focus keeps it open, Tab visits controls/scroll viewport, Escape/Close restores source focus, navigation focuses the reader. Focus-triggered scrolling preserves the request.                                                                                          | Electron keyboard-only transfer to both actions, wait beyond dismissal timeout, Escape return without reopening, opposite-pane activation and reader focus. Existing pointer behavior retained.                                                                                                                                                                                                                |
| 7 — Responsive controls | Actual workspace dimensions select stacking and constrain pane ratios. Toolbars/search wrap using pane containers; essential controls remain exposed.                                                                                                                                                 | Electron tests check every control bounding box for both orientations, requested 20/50/80 splits, sidebar on/off, search on/off at 760 × 560.                                                                                                                                                                                                                                                                  |
| 8 — Contrast            | Darker light-theme muted/subtle tokens, readable dark subtle token, minimum 11 px supporting labels, accessible primary-button background and preview-message text.                                                                                                                                   | Computed foreground/background contrast checks in both themes and normal/hover/focus states; keyboard reading/navigation exercised. Human screen-reader review remains a release-platform check.                                                                                                                                                                                                               |

Hardening is implemented: production document **and worker responses** carry CSP; only development permits local HMR WebSockets. Dedicated local workers avoid PDF.js blob wrappers. Permission checks and requests both deny by default. Packaged builds ignore development URL overrides. Electron fuses disable Node/debug/environment and extra file entry points, require ASAR, and enable supported integrity validation. Typed IPC request/event maps and typed PDF viewer events replace source `any` callbacks while runtime argument/session validation remains. CI action pins resolve to specific upstream commits; action metadata was inspected, checkout credentials are not persisted, and formatting runs in CI. `noUncheckedIndexedAccess` was considered but is not enabled in this pass; bounded indexing and runtime sanitisation remain in place.

`electron-builder.release.yml`, macOS hardened-runtime entitlements and [SECURITY.md](SECURITY.md) prepare trusted releases and define update triage, checks and publication. Real application/contact/release metadata, signing identities/private keys, Apple notarisation credentials, a publishing channel and a responsible release/security contact remain unavailable. No signed/notarised release is claimed.

### Remediation verification

| Check                                                                                     | Result                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` / production build                                                    | Passed, including the Electron integration build                                                                                                                                                                                         |
| `npm test`                                                                                | 35 passed across 7 files                                                                                                                                                                                                                 |
| `npm run test:e2e`                                                                        | 29 passed, no skips; includes generated print PDF/raster comparison, persisted-history/handle checks and all original reading workflows                                                                                                  |
| Final expanded contrast regression                                                        | Passed for both themes, including the preview error overlay (the former overlay colour measured 4.47:1 and is now 5.57:1 on white)                                                                                                       |
| `npm run format:check` / `git diff --check`                                               | Passed; audit and security documentation included in formatting                                                                                                                                                                          |
| `npm run dist:linux` / final `npx electron-builder --linux --x64 --publish never`         | Fresh x64 AppImage and Debian package built with hardened fuses                                                                                                                                                                          |
| `npm run test:packaged`                                                                   | Passed against the rebuilt Linux unpacked executable: fuse inspection, offline sample/preview/split, dedicated packaged worker and response CSP, denied permission query, state save, ignored development URL/Node environment overrides |
| Release profile schema/merge validation                                                   | Passed through electron-builder `getConfig` and `validateConfiguration`; signing/notarisation not attempted                                                                                                                              |
| `npm audit --json`                                                                        | 0 reported vulnerabilities                                                                                                                                                                                                               |
| Windows/macOS builds and native signing/notarisation                                      | Not run on this Linux host; credentials, metadata and platform access remain required                                                                                                                                                    |
| Physical printing, screen readers, installed file associations and OS sandbox enforcement | Not run; native print was stubbed to generate actual PDF output, and GUI automation used `--no-sandbox`                                                                                                                                  |

Linux GUI tests use isolated temporary profiles and Xvfb/`--no-sandbox`; production sandbox settings remain enabled, but OS sandbox enforcement, physical printing, screen readers, installers/file associations, Windows and macOS signing/notarisation require their respective platform checks. The packaged smoke harness uses Chromium CDP so the shipped Node-inspector fuse remains disabled.

## Original assessment

The app has a good foundation: a clear purpose, a polished welcome screen, useful link previews, independent split panes, and substantial integration coverage. The architecture sensibly separates native operations from PDF rendering. The main gaps are privacy during printing/history clearing, recovery from failure, resource budgets, and accessibility.

No critical exploit, arbitrary command execution, or unregistered-file read was confirmed in this audit. The dependency audit returned no known vulnerabilities. These results cover the reviewed code and probes, rather than guaranteeing that hostile PDFs or the underlying browser/PDF parser are vulnerability-free.

The findings below are P2: meaningful issues to address in the next hardening pass. Security hardening and release preparation are listed separately so they are not confused with demonstrated exploits. At the original audit, application source was left unchanged. The remediation status above describes the subsequent implementation.

## Original audit verification

| Check                                                              | Result                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `npm run typecheck`                                                | Passed                                                             |
| `npm test`                                                         | 25 tests passed across 4 files                                     |
| `npm run format:check`                                             | Passed on the original project files                               |
| Production build through `npm run test:e2e`                        | Passed                                                             |
| Electron end-to-end suite                                          | 17 passed; packaged-only test skipped as intended                  |
| `npm run test:packaged`                                            | 1 passed against the existing Linux unpacked distribution          |
| `npm audit --json`                                                 | 0 reported vulnerabilities                                         |
| Encoded slash/backslash traversal through `app://reader`           | Both probes returned 403                                           |
| External `file:`, `javascript:`, `data:`, and `ftp:` URLs          | All rejected by the native bridge                                  |
| Renderer Node access                                               | Existing integration test confirms `window.require` is unavailable |
| Targeted privacy, startup, accessibility, crash, and layout probes | Reproductions described below                                      |

Targeted probes used temporary profiles and generated fixtures. They did not open the user's papers or invoke a physical printer. Linux GUI tests used Xvfb and `--no-sandbox`, consistent with the existing test launcher; the configured production sandbox was inspected, but OS sandbox enforcement was not validated by those runs. The existing packaged distribution passed its smoke test; installers were not rebuilt, installed, or tested on Windows/macOS during this audit.

## Original findings

### 1. P2 — Concurrent print jobs can mix documents

**Locations:** `src/renderer/src/components/DocumentTab.tsx:231`, `src/renderer/src/App.tsx:147`, `src/renderer/src/pdf/printing.ts:8`, `src/renderer/src/styles.css:1389`.

The print lock belongs to each tab, while the print DOM and `body.printing` class belong to the whole application. The HTML modal does not stop native menu commands from switching tabs. A second tab can therefore start a second print job, creating duplicate `#print-pages` elements. The print stylesheet selects both elements, and either job's cleanup can also remove the shared printing class while the other is active.

**Reproduced:** Open `long.pdf` and `scanned.pdf`. Start printing the long document, invoke **Window → Next tab** while preparation is active, and print the scanned document. The second tab had no visible preparation modal from the first job. At the native print entry point, a printer stub observed two print containers with page counts **[4, 1]**. This establishes that another document's prepared pages are present in the printable DOM; no physical print was performed.

**Impact:** Incorrect output and potential disclosure of pages from another open document.

**Fix:** Own print preparation and its lock at application level. Use one print container with explicit job ownership. Gate print requests from both menus and buttons while a job is active, and ensure cleanup can affect only its own job.

**Regression check:** Start preparation in one tab, switch through the native menu, request printing in another, and assert a single job/container and output containing only the chosen document.

### 2. P2 — “Clear recent” can leave a cleared document's path on disk

**Locations:** `src/main/store.ts:89`, `src/main/store.ts:103`, `src/renderer/src/App.tsx:77`, `src/renderer/src/App.tsx:488`.

`clearRecent()` decides which file records to keep using the last saved session. The renderer saves tab changes after a 350 ms debounce. Closing the final tab and immediately clearing recent history can therefore preserve its record as though the tab were still open, setting only `lastOpened = 0`. The next session save does not remove that record because persistence retains the first 100 records regardless of timestamp.

**Reproduced:** After opening a paper and allowing its session to save, close its tab and immediately click **Clear recent**. After the following session save, the welcome screen contained no recent items and `session.tabs` was empty, but `reader-state.json` still held the paper's absolute path with `lastOpened: 0`.

**Impact:** History appears cleared while a hidden path record remains. Its registered document handle also remains valid during the process lifetime.

**Fix:** Make clearing history operate on an explicit current snapshot, or serialize a snapshot save and history clearing as one native operation. Remove records once they are neither open nor retained as history. Preserve intentional position memory separately from path/access records.

**Regression check:** Close the last tab and clear history before the debounce expires; verify that its path is absent from disk and that the old handle is rejected.

### 3. P2 — File-open events arriving during bootstrap can be lost

**Locations:** `src/main/index.ts:68`, `src/main/index.ts:123`; related renderer handoff at `src/renderer/src/App.tsx:174`.

Bootstrap takes `pendingPaths`, clears the queue, and awaits registration of the captured paths before setting `rendererReady`. An OS file-open event during that await is added to the replacement queue, but bootstrap never drains that queue. There is also a separate handoff window: the main process marks the renderer ready before the renderer finishes restoring tabs, so an early `onFiles` update can be overwritten by the restoration's `setTabs(restoredTabs)`.

**Reproduced for the pending-queue case:** Launch with 60 small password-protected fixture copies. After the first launch file is registered, emit an OS `open-file` event for `scanned.pdf`. Startup finishes with **60 tabs rather than 61**; the additional file is absent. The large batch makes an existing race deterministic; the same window exists with fewer files on slower storage. The separate renderer restoration race is source-identified rather than independently reproduced.

**Fix:** Introduce an explicit bootstrap acknowledgement and drain queued opens after the renderer has applied restored state. Merge incoming descriptors with existing tabs rather than replacing newer state during restoration.

**Regression check:** Inject opens during native registration and renderer restoration, and verify that every requested file appears exactly once.

### 4. P2 — Document loading and printing lack application resource budgets

**Locations:** `src/main/store.ts:74`, `src/renderer/src/pdf/engine.ts:31`, `src/renderer/src/components/DocumentTab.tsx:119`, `src/renderer/src/pdf/printing.ts:21`.

The main process reads an entire PDF into memory, wraps it in a new typed array, and transfers it through IPC; the renderer makes another typed-array copy before handing it to PDF.js. Every mounted document tab starts loading, including tabs that have never been selected. Session restoration permits 100 tabs.

Printing renders every page at 150 DPI, explicitly decodes every image, and retains all prepared page elements/blob URLs until the job finishes. Unlike normal viewing and previews, the print path has no canvas pixel limit. An A4 page at this resolution represents approximately **8.3 MiB of raw RGBA pixels**; 120 pages represent about **1 GiB** before accounting for other allocations. Browser caching affects actual resident memory, so this is a pixel-budget calculation, not a measured RSS claim.

**Impact:** Ordinary large papers, books, or crafted page dimensions can cause excessive allocations or rendering failures. Restoring the same documents can repeat the problem on launch. Source review confirmed the missing limits; destructive out-of-memory tests were intentionally not run.

**Fix:** Add a generous documented file-size policy and loading concurrency limit. Delay background parsing until needed, and consider scoped streaming/range reads for large files. Bound print dimensions and total preparation cost, and provide a clear fallback for documents that exceed the budget. Keep a responsive cancellation path.

**Regression check:** Use a large sparse file, an oversized page box, and a session with many tabs; assert controlled errors or bounded scheduling without allocating the full worst case.

### 5. P2 — A crashed renderer leaves the app unusable

**Locations:** `src/main/index.ts:231`, `src/renderer/src/main.tsx:6`.

The main window has no `render-process-gone` or unresponsive recovery handling. React also has no application/document error boundary. PDF.js and component exceptions are often caught locally, which is good, but failures outside those paths can still remove the entire interface.

**Reproduced:** Force a renderer crash in an isolated profile. After one second the app still had one open window whose web contents reported `isCrashed() === true`, with no reload/recovery interface. The production menu provides no reload action. The absence of a React error boundary was verified by source inspection, not by a separate forced React exception.

**Fix:** Offer native recovery when the renderer exits unexpectedly, with an option to reopen without restoring documents. Add an error boundary around document content with an accessible retry/close action. Avoid automatically reloading a repeatedly crashing document indefinitely.

**Regression check:** Crash the renderer and throw from a document component; verify recovery without editing the state file or restarting repeatedly.

### 6. P2 — Keyboard focus cannot remain inside a preview

**Locations:** `src/renderer/src/components/ReaderPane.tsx:136`, `src/renderer/src/components/DocumentTab.tsx:109`, `src/renderer/src/components/Preview.tsx:103`.

Leaving the source link schedules dismissal after 220 ms, including on keyboard blur. The preview cancels that timer only on pointer entry. Its portal has no focus-enter handling or deliberate keyboard transfer/return mechanism.

**Reproduced:** Focus an internal link and let its preview open, then programmatically focus **Open here** to test the focus transition directly. After 450 ms the preview had disappeared and focus was on the document body. This occurs even when focus is explicitly placed inside the preview; normal tab order makes reaching its controls harder still.

**Fix:** Keep the preview open while focus is within it, provide an explicit way to enter it from the source link, and restore focus when it closes. Treat the source and preview as a shared focus region while retaining pointer hover behavior.

**Regression check:** Navigate from the link into each preview action using the keyboard, wait beyond the dismissal timeout, activate navigation, and verify sensible focus after Escape.

### 7. P2 — Supported pane sizes can hide essential controls

**Locations:** `src/renderer/src/components/DocumentTab.tsx:301`, `src/renderer/src/components/DocumentTab.tsx:514`, `src/renderer/src/styles.css:576`.

The divider permits a 20% pane at every window size, but the toolbar has no corresponding compact layout or minimum pane width. Media queries depend on window width rather than the actual pane width.

**Reproduced:** At the supported **760 × 560** window size, keep the sidebar open and resize the first pane to 20%. Its toolbar measured **113 px client width / 174 px scroll width**. The page input, zoom selector, zoom-in button, and close-pane button extended outside the pane's bounds. The default 50/50 split fit at this size; the failure is specifically the supported resize range.

**Fix:** Use pane container queries and an overflow menu, or derive divider limits from a usable minimum pane width. Automatically stack panes when horizontal controls cannot fit.

**Regression check:** Test minimum window dimensions, both orientations, 20/50/80% splits, sidebar visibility, and search controls. Assert actionable controls stay within their pane or remain reachable through a menu.

### 8. P2 — Light-theme navigation text has insufficient contrast

**Locations:** `src/renderer/src/styles.css:15`, `src/renderer/src/styles.css:406`.

Normal 11 px outline text uses `--muted: #7b8594` on a white surface: **3.73:1** contrast. The same token on the app background is **3.48:1**. These are below the WCAG AA 4.5:1 threshold for normal-sized text. The subtle token is only **2.34:1** on white. Several supporting labels are also 8–10 px.

**Fix:** Use a darker token for informative secondary text and increase small control/label type where space permits. Keep lighter colours for decoration. Preserve the existing quiet visual style while making reading controls easier to perceive.

**Regression check:** Measure both themes and relevant hover/focus states; check navigation and search with keyboard-only use and a screen reader. The dark theme's muted token on its surface measured 5.75:1, so the light-theme token should be addressed specifically.

## Security hardening and release preparation

These are useful improvements with explicit limits on what was demonstrated:

- **Remove development network allowances from production CSP.** `src/renderer/index.html:8` permits WebSockets to any localhost/127.0.0.1 port in production. A controlled listener confirmed that renderer JavaScript could initiate a local WebSocket handshake. This needs renderer script execution and is not a standalone PDF exploit. Use a build-specific production policy with `connect-src 'self'`; consider response CSP headers for worker assets as well as the document's meta policy.
- **Make permission checks match permission requests.** `src/main/index.ts:104` denies permission requests but does not install a permission check handler. Queries for camera, geolocation, and clipboard-read all returned `granted`; an actual clipboard-read attempt was denied. Install a deny-by-default check handler too. No camera, location, or clipboard disclosure was established.
- **Harden packaged Electron fuses.** Inspection of the existing Linux binary found RunAsNode, Node options, CLI inspect arguments, and extra `file:` privileges enabled; OnlyLoadAppFromAsar was disabled. Disable unused Node/debug entry points and extra file privileges, require ASAR loading, and enable supported archive integrity validation. These reduce local tampering and post-exploitation opportunities; their defaults do not establish remote execution in this app.
- **Restrict development overrides to development builds.** `src/main/index.ts:21` accepts `ELECTRON_RENDERER_URL` even in a packaged app. Because the IPC trust check also trusts that origin, an inherited development override can point the app at a different frontend. Gate the override with `!app.isPackaged`. Exploitation requires control over the launch environment.
- **Prepare trusted releases.** macOS identity is explicitly null, CI builds unsigned installers, package contact details use a reserved placeholder domain, and updates are manual. Before broad distribution, set real metadata, sign/notarise appropriate builds, publish verifiable release artifacts, and define an Electron/PDF.js security-update process. Keep signing secrets unavailable to untrusted pull requests.
- **Strengthen regression coverage and maintainability.** Add tests for the findings and native trust boundaries. The current suite is strong on normal reading flows but does not exercise these races and failure paths. Replace `any` IPC callback/event payloads with typed channel/event maps, retain runtime validation, and consider `noUncheckedIndexedAccess`. Pin CI actions to reviewed commit hashes and add the existing format check to CI. These are improvements, rather than evidence that current type-checking is broken.

## What already works well

- Explicit renderer sandboxing, context isolation, disabled Node integration, and web security.
- A preload bridge exposing individual operations, rather than generic IPC or filesystem calls; native handlers check both the sending web contents and the main frame.
- Canonical PDF registration, native handle lookup, private state-file creation, and serialized temporary-file/rename persistence.
- Blocked window creation/navigation, external scheme allowlisting, packaged PDF assets, disabled XFA, and no scripting manager in the PDF viewers.
- Strict TypeScript, pinned direct dependencies, a lockfile, minimal CI repository permissions, and repeatable fixtures.
- Real PDF.js end-to-end tests for the core differentiators: previews, both-direction split navigation, selection, password retry, lazy rendering, restoration, and print preparation.
- A coherent interface and an original sample paper that makes the main interactions discoverable immediately.

## Path to an excellent release

1. Fix printing isolation and history clearing first; both can violate privacy expectations.
2. Make file opening dependable under startup races, add recovery, and set resource budgets.
3. Finish keyboard preview navigation, compact pane controls, and accessible light-theme colours.
4. Harden production networking/packaging and establish a trusted security-update process.
5. Build on the existing reading focus: add an in-app shortcut guide, clear unavailable-file recovery, and an easy way to pin a preview or return to its source. Treat these as product opportunities, not confirmed defects. OCR, bibliography tools, and annotation editing are explicitly outside the current version and are not counted as audit failures.

The strongest route to “awesome” is to make the existing reading workflow dependable and accessible before expanding its feature set.
