# Margin PDF for Chrome

A Manifest V3 PDF reader that replaces Chrome’s PDF viewer with Margin PDF’s link previews, independent split panes, search, outline, thumbnails, printing, and five appearance skins. Requires **Chrome 151 or later**. Uses Chrome’s public PDF MIME-handler API; the original PDF URL stays in the address bar. The desktop application does not need to be installed or running.

## Build and install locally

From the repository root, with Node 24+:

```sh
npm ci
npm run dist:chrome
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select `extensions/chrome/dist` in this repository.
3. Open a PDF URL or a local PDF in Chrome. Margin PDF handles it automatically.
4. Pin the extension and click its icon to open the welcome screen, select a local file, or try the bundled sample. Local files can also be dropped onto this screen.

Chrome routes documents served as `application/pdf`, including URLs without a `.pdf` suffix and documents embedded in full frames. POST responses and single-use URLs use Chrome’s existing response stream. The extension does not make a second request to the original URL. Responses served as downloads, HTML viewers supplied by a website, and non-PDF MIME types follow Chrome/site behaviour. Older Chrome versions cannot install this package; update Chrome first.

Use **Reader settings → Open PDFs in Margin PDF** to disable automatic handling. The **Chrome viewer** button returns the current document to Chrome’s native reader. If several PDF-handler extensions are installed, Chrome selects the most recently installed handler. This build is not tested on other Chromium browsers or Firefox.

The reader uses one compact bar containing the logo, page/zoom controls, the document title in the middle when there is room, and document actions. Click or focus either reading pane to control that pane from the bar. Local files open from the welcome screen, drag-and-drop or Ctrl/Cmd+O. Printing and fullscreen are in **More reader actions**, with download moving there on narrow screens.

Ctrl/Cmd+Plus (or equals), Minus and the numeric keypad's plus/minus zoom only the active PDF pane, including while a page number or search field has focus. Ctrl/Cmd+0 fits the pane to its width. For full-page PDFs, Chrome's browser zoom controls also zoom the active PDF pane while the toolbar stays at its normal size. Embedded PDFs leave the surrounding web page's browser zoom unchanged.

Use Chrome’s Reload to obtain a new copy from the source. Desktop file watching and SyncTeX are not available in the extension. PDFs are limited to 128 MiB. Printing prepares pages sequentially using one reusable canvas and compressed image tiles at 150 DPI; it has no page-count or combined raster-area cutoff. The working canvas is bounded to 8,388,608 pixels per tile, and large sheets use multiple tiles.

In **Reader settings → PDF tab titles**, choose whether full-page PDFs retain the website title or use the PDF metadata title. You can restrict this to a domain list (prefilled with `arxiv.org`, including subdomains) or apply it to all HTTP/HTTPS sites. Click **Apply title settings** and grant Chrome's site-access request. The option starts off. Embedded PDFs preserve the host page's title. Settings also link to the GitHub repository.

## Privacy and packaging

The required permissions are `storage` for preferences and optional reading positions, and `scripting` for the opt-in tab-title feature. Site access is optional and requested only when applying title rules. PDF reading needs no site access. No network interception, persistent content scripts, telemetry, remote code or external services are used. Reading positions are stored locally by content fingerprint, capped at 100, and can be cleared. The privacy policy is bundled at `privacy.html` and accessible from the reader.

`npm run dist:chrome` builds a ZIP with `manifest.json` at its root:

```text
dist/margin-pdf-chrome-0.2.0.zip
```

Upload this ZIP to the Chrome Web Store developer dashboard. See [STORE_LISTING.md](STORE_LISTING.md) for listing copy, permission justification, screenshots, and remaining account/hosting steps. Store approval is determined by Google; building the package does not publish it.

## Verification

```sh
npm run test:chrome
```

Runs integration tests in a fresh Chromium profile, using the installed Chromium executable if available. Set `MARGIN_CHROME_EXECUTABLE` to a Chrome/Chromium 151+ executable on other machines. The Playwright bundled browser can also be used once it reaches version 151. Test PDFs and the HTTP server are local. No personal browser profile is used.

Official API reference: https://developer.chrome.com/docs/extensions/reference/api/mimeHandler
