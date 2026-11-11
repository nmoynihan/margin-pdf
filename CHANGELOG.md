# Changelog

## 0.1.0 — 2026-11-11

First public source release of Margin PDF.

- Desktop reader with selectable link previews, independent split panes, search, outlines, thumbnails and reading-position restoration.
- Five appearance skins, independent workspace layouts and a compact reading mode.
- Automatic reload when a local PDF is rebuilt, preserving pane positions and zoom.
- Immediate reading-position capture after navigation, so reload, layout changes and recovery retain the selected page even when scroll events are delayed.
- Chrome extension using Chrome 151+ PDF integration, with one compact toolbar, active-pane page/zoom controls, downloads, printing and local preferences.
- VS Code custom PDF editor with forward and reverse SyncTeX in trusted local workspaces.
- Sequential print preparation with bounded 150 DPI tiles, supporting long documents and large sheets without a document-wide raster or page-count cutoff.
- Sandboxed desktop renderer, bundled PDF workers/codecs, third-party notices and platform packaging checks.

Desktop installers built by the ordinary CI workflow are unsigned test builds. Store listings, AUR distribution, signed installers and automatic desktop updates are not yet published.
