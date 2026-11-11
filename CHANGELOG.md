# Changelog

## 0.2.0 — 2026-11-11

- Removed promotional copy and visible pane names across editions.
- Right-aligned search bars use at most half the pane width.
- Chrome: optional PDF titles in browser tabs, with domain rules prefilled with arxiv.org; removed in-memory reload controls and added a GitHub link in settings.
- VS Code: one toolbar without a document title; update messages appear in that toolbar, can be dismissed, and expire after 15 seconds.
- Prebuilt Windows, macOS, Linux, Chrome and VS Code packages are available on GitHub Releases, with SHA-256 checksums. Desktop installers are unsigned.
- Release filenames are normalized before generating checksums so they match GitHub's download names.

## 0.1.0 — 2026-11-11

First public source release of Margin PDF.

- Desktop reader with selectable link previews, independent split panes, search, outlines, thumbnails and reading-position restoration.
- Five appearance skins, independent workspace layouts and a compact reading mode.
- Automatic reload when a local PDF is rebuilt, preserving pane positions and zoom.
- Immediate reading-position capture after navigation, so reload, layout changes and recovery retain the selected page even when scroll events are delayed.
- Chrome extension using Chrome 151+ PDF integration, with one compact toolbar, active-pane page/zoom controls, downloads, printing and local preferences.
- Chrome keyboard and browser zoom controls scale the active PDF pane while the toolbar stays fixed; the document title appears in the middle of the bar when space allows.
- VS Code custom PDF editor with forward and reverse SyncTeX in trusted local workspaces.
- Sequential print preparation with bounded 150 DPI tiles, supporting long documents and large sheets without a document-wide raster or page-count cutoff.
- Sandboxed desktop renderer, bundled PDF workers/codecs, third-party notices and platform packaging checks.

Desktop installers built by the ordinary CI workflow are unsigned test builds. Store listings, AUR distribution, signed installers and automatic desktop updates are not yet published.
