# Margin PDF for VS Code

Margin PDF opens PDFs in a VS Code editor tab with hover previews, independent split panes, and bidirectional SyncTeX. It shares its React/PDF.js reader with the Margin PDF desktop application.

Page, zoom, sidebar, search and document actions share one toolbar without a document title or pane names. Search is right-aligned and uses at most half a pane's width. Disk-update messages appear in the toolbar, have a dismiss button and disappear after 15 seconds.

## Install

From the repository root, run `npm ci` and `npm run dist:vscode`. In VS Code, run **Extensions: Install from VSIX…** and select `dist/margin-pdf-reader-0.2.0.vsix`. Alternatively:

```sh
code --install-extension dist/margin-pdf-reader-0.2.0.vsix
```

The extension works offline on local desktop VS Code 1.145 or newer. Remote SSH, containers, and browser VS Code are not supported yet. No desktop installation is required.

## Open and synchronize

- In a LaTeX source file, run **Margin PDF: Open PDF Beside Source**, or use its editor-title button.
- For any PDF, use **Reopen Editor With… → Margin PDF**. You may make it your default PDF editor in that picker.
- Run **Margin PDF: Sync PDF from Cursor** to reveal the PDF location corresponding to the source cursor. The selected pane moves; the other pane stays in place.
- **Ctrl+click** PDF content to reveal its source. On macOS, Cmd+click also works. Ctrl/Cmd+click on PDF links retains Margin's opposite-pane navigation.
- Hover an internal link for a selectable preview. Use the toolbar for search, split panes, reload, and the collapsible outline/thumbnails sidebar.

LaTeX Workshop can continue compiling your project. Compile with `-synctex=1` so a `.synctex.gz` or `.synctex` file is generated. Margin watches open PDFs and preserves positions when they are rebuilt. The extension does not replace LaTeX Workshop's own View/SyncTeX commands or toolbar buttons.

Output discovery follows remembered source/PDF associations, `% !TeX root = main.tex` directives, and conventional `latex-workshop.latex.outDir` settings (`%DIR%`, `%DOC%`, `%DOCFILE%`). If discovery is ambiguous, choose the compiled PDF once. **Margin PDF: Associate Source with PDF** changes an association. For included chapters, a TeX root directive is recommended. Reading positions and associations are stored in the VS Code workspace, separately from desktop state.

Optional keyboard shortcuts in VS Code's `keybindings.json`:

```json
[
  {
    "key": "ctrl+alt+v",
    "mac": "cmd+alt+v",
    "command": "marginPdf.openBeside",
    "when": "editorTextFocus && editorLangId == latex"
  },
  {
    "key": "ctrl+alt+j",
    "mac": "cmd+alt+j",
    "command": "marginPdf.syncFromCursor",
    "when": "editorTextFocus && editorLangId == latex"
  }
]
```

These shortcuts select Margin instead of LaTeX Workshop's viewer for those key combinations.

## Settings

| Setting                      | Default   | Purpose                                                                              |
| ---------------------------- | --------- | ------------------------------------------------------------------------------------ |
| `marginPdf.synctexPath`      | `synctex` | Local SyncTeX executable, with no command-line arguments.                            |
| `marginPdf.synctexDirectory` | empty     | Optional directory containing SyncTeX data, absolute or relative to the source root. |

PDF reading works without SyncTeX. Missing mapping data reports a message without closing the PDF. SyncTeX execution requires a trusted workspace.

The compact reader follows VS Code's theme. Desktop-only printing/fullscreen controls are omitted. To use the compact layout outside VS Code, launch `margin-pdf --compact paper.pdf`; use **View → Compact layout** or **More reader actions → Use full layout** to switch back. The launch override does not overwrite saved desktop layout preferences.

## Development

Run `npm run build:vscode` in the repository root, then launch VS Code with `--extensionDevelopmentPath=/absolute/path/to/PDF_JUNKIE/extensions/vscode`. Run `npm run test:vscode` for the real VS Code integration suite; it requires a local VS Code executable and `pdflatex`. Set `VSCODE_EXECUTABLE_PATH` if VS Code is installed somewhere other than `/usr/share/code/code`.

Both targets use the same reader source. `npm run build` builds the desktop app; `npm run build:vscode` builds the extension; `npm run dist:vscode` creates the installable VSIX without publishing it.
