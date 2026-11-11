import { PDFDocument, StandardFonts, PDFName, PDFString, degrees, rgb } from 'pdf-lib'
import { createCanvas } from '@napi-rs/canvas'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

await mkdir('tests/fixtures', { recursive: true })
await mkdir('src/renderer/public', { recursive: true })
const pdf = await PDFDocument.create()
pdf.setTitle('Reading without losing the thread')
pdf.setAuthor('Margin PDF • Sample paper')
pdf.setSubject(
  'An interactive sample document, with fictional references, for testing PDF navigation.',
)
pdf.setCreationDate(new Date('2026-01-01T00:00:00Z'))
pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'))
const serif = await pdf.embedFont(StandardFonts.TimesRoman)
const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic)
const sans = await pdf.embedFont(StandardFonts.Helvetica)
const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
const ink = rgb(0.16, 0.2, 0.25),
  muted = rgb(0.42, 0.46, 0.5),
  green = rgb(0.23, 0.43, 0.35)
const pages = Array.from({ length: 5 }, () => pdf.addPage([595, 842]))
const text = (page, value, x, y, size = 11, font = serif, color = ink) =>
  page.drawText(value, { x, y, size, font, color })
function paragraph(page, value, x, y, width, size = 11, font = serif, leading = 16) {
  let line = ''
  let cursor = y
  for (const word of value.split(/\s+/)) {
    if (font.widthOfTextAtSize(`${line} ${word}`, size) > width && line) {
      text(page, line, x, cursor, size, font)
      cursor -= leading
      line = word
    } else line += `${line ? ' ' : ''}${word}`
  }
  if (line) text(page, line, x, cursor, size, font)
  return cursor - leading
}
function heading(page, value, y) {
  text(page, value, 55, y, 16, bold)
  return y - 28
}
function link(page, label, x, y, destination, external = false) {
  text(page, label, x, y, 11, serif, green)
  const width = serif.widthOfTextAtSize(label, 11)
  const annotation = pdf.context.register(
    pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [x - 2, y - 3, x + width + 2, y + 12],
      Border: [0, 0, 0],
      A: external
        ? { S: 'URI', URI: PDFString.of(destination) }
        : {
            S: 'GoTo',
            D: typeof destination === 'string' ? PDFString.of(destination) : destination,
          },
    }),
  )
  page.node.addAnnot(annotation)
}
for (const [index, page] of pages.entries()) {
  text(page, 'MARGIN PDF   /   INTERACTIVE SAMPLE', 55, 795, 8, sans, muted)
  page.drawLine({
    start: { x: 55, y: 782 },
    end: { x: 540, y: 782 },
    thickness: 0.5,
    color: rgb(0.8, 0.83, 0.83),
  })
  text(page, 'Sample document - references and results are illustrative.', 55, 37, 8, sans, muted)
  text(page, String(index + 1), 530, 37, 9, sans, muted)
}
const intro = pages[0]
text(intro, 'Reading without losing', 55, 725, 27, bold)
text(intro, 'the thread', 55, 691, 27, bold)
text(intro, 'A small study in following references', 55, 660, 13, italic, muted)
text(intro, 'Margin PDF   |   Reader experience notes   |   2026', 55, 631, 9, sans, muted)
heading(intro, 'Abstract', 587)
paragraph(
  intro,
  'Reading an academic paper means moving between an argument and its supporting material. This sample demonstrates a reader that keeps that context close: hover over the green links below to inspect their targets, or Ctrl+click to open them in a second pane. On macOS, Command+click also works.',
  55,
  558,
  485,
)
heading(intro, '1. Introduction', 454)
paragraph(
  intro,
  'References give a paper its structure. A sentence may point to a definition, a figure, a later section, or a bibliography entry. Following that connection should preserve the passage that prompted the question.',
  55,
  425,
  485,
)
text(intro, 'Try these embedded PDF links:', 55, 355, 11, bold)
link(intro, '[1] A bibliography entry', 55, 321, 'ref-one')
link(intro, 'Section 2: two-column reading', 55, 289, 'section-two')
link(intro, 'Figure 1: returning to context', 55, 257, 'figure-one')
link(intro, 'Appendix A: a rotated page', 55, 225, [pages[4].ref, PDFName.of('Fit')])
link(intro, 'PDF.js project website', 55, 193, 'https://mozilla.github.io/pdf.js/', true)
link(intro, 'Unavailable target', 335, 193, 'missing-destination')
paragraph(
  intro,
  'The links in this sample are real PDF annotations. Previews show the original page, including its typography and diagrams. Plain text references in documents without embedded links will remain ordinary text.',
  55,
  139,
  485,
  10,
  italic,
  14,
)

const two = pages[1]
heading(two, '2. Reading in two columns', 735)
const column =
  'An academic page often places two threads of text beside one another. A destination can identify either column using coordinates in the PDF page. Keeping those coordinates is especially useful for equations, definitions, and individual references. The reader uses the PDF link itself to find this location.'
for (const x of [55, 315]) {
  let y = paragraph(two, column, x, 695, 222)
  y = paragraph(
    two,
    'A second view can answer a local question while the first retains the argument. Each pane has its own zoom, rotation, search, and history. Try splitting this reference, then navigate from the second pane back to the first.',
    x,
    y - 12,
    222,
  )
  link(
    two,
    x === 55 ? 'Reference [1]' : 'Reference [2]',
    x,
    y - 150,
    x === 55 ? 'ref-one' : 'ref-two',
  )
  paragraph(
    two,
    'Both panes display the same underlying document. Closing either pane leaves the remaining view in place. Use the layout button to switch between a side-by-side arrangement and stacked panes.',
    x,
    y - 190,
    222,
  )
}
link(two, 'Return to the introduction', 55, 130, 'intro')
const fig = pages[2]
heading(fig, '3. A figure within reach', 735)
paragraph(
  fig,
  'A preview retains the original figure. It does not reconstruct the diagram from extracted text. The following illustrative chart is included to make this visible in the hovering window.',
  55,
  695,
  485,
)
fig.drawRectangle({ x: 70, y: 335, width: 455, height: 265, color: rgb(0.97, 0.98, 0.97) })
for (let i = 0; i < 5; i++)
  fig.drawLine({
    start: { x: 105, y: 365 + i * 46 },
    end: { x: 500, y: 365 + i * 46 },
    thickness: 0.5,
    color: rgb(0.83, 0.87, 0.85),
  })
for (let i = 0; i < 8; i++)
  fig.drawRectangle({
    x: 125 + i * 45,
    y: 365,
    width: 22,
    height: 35 + i * 19 + (i % 2 ? 12 : 0),
    color: green,
    opacity: 0.45 + i * 0.06,
  })
text(fig, 'Reading sessions (illustrative)', 205, 345, 9, sans, muted)
text(fig, 'Figure 1. Returning to context.', 70, 307, 11, bold)
paragraph(
  fig,
  'Each bar represents an invented reading session. This figure is a navigation example rather than research evidence.',
  70,
  285,
  455,
  10,
  italic,
)
link(fig, 'Return to Section 1', 55, 200, 'intro')

const refs = pages[3]
heading(refs, 'References', 735)
text(refs, '[1]', 55, 664, 11, bold)
paragraph(
  refs,
  'Morgan, A. and Lee, R. Reading without losing context. Journal of Illustrative Interfaces, 12(3), 41-56 (2026). This is a fictional reference created for this sample.',
  82,
  664,
  458,
)
text(refs, '[2]', 55, 555, 11, bold)
paragraph(
  refs,
  'Chen, S. A second view of the same page. Proceedings of the Sample Reading Workshop, 88-94 (2026). This is a fictional reference. The right-column link on page 2 points here.',
  82,
  555,
  458,
)
text(refs, '[3]', 55, 446, 11, bold)
paragraph(
  refs,
  'Mozilla contributors. PDF.js: a general-purpose, web standards-based platform for parsing and rendering PDFs. See the project website for documentation.',
  82,
  446,
  458,
)
link(refs, 'Back to the introduction', 55, 320, 'intro')
link(refs, 'Back to Figure 1', 55, 285, 'figure-one')
const rotated = pages[4]
rotated.setRotation(degrees(90))
heading(rotated, 'Appendix A. Rotated page', 735)
paragraph(
  rotated,
  'This page carries a 90-degree rotation in its PDF page dictionary. The viewer, thumbnails, print preparation, and destination coordinates should all respect that rotation. Use the rotate control to adjust the reading view independently in either pane.',
  55,
  695,
  485,
)
link(rotated, 'Return to the introduction', 55, 590, 'intro')

const names = [
  ['figure-one', [pages[2].ref, PDFName.of('XYZ'), 55, 620, null]],
  ['intro', [pages[0].ref, PDFName.of('XYZ'), 55, 470, null]],
  ['ref-one', [pages[3].ref, PDFName.of('XYZ'), 50, 686, null]],
  ['ref-two', [pages[3].ref, PDFName.of('XYZ'), 50, 577, null]],
  ['section-two', [pages[1].ref, PDFName.of('FitH'), 755]],
]
pdf.catalog.set(
  PDFName.of('Names'),
  pdf.context.obj({
    Dests: {
      Names: names.flatMap(([name, destination]) => [
        PDFString.of(name),
        pdf.context.obj(destination),
      ]),
    },
  }),
)
const outline = pdf.context.register(pdf.context.obj({ Type: 'Outlines', Count: 5 }))
const items = [
  '1. Introduction',
  '2. Reading in two columns',
  '3. A figure within reach',
  'References',
  'Appendix A',
].map((title, index) =>
  pdf.context.register(
    pdf.context.obj({
      Title: PDFString.of(title),
      Parent: outline,
      Dest: [pages[index].ref, PDFName.of('FitH'), 755],
    }),
  ),
)
items.forEach((ref, index) => {
  const item = pdf.context.lookup(ref)
  if (index) item.set(PDFName.of('Prev'), items[index - 1])
  if (index < items.length - 1) item.set(PDFName.of('Next'), items[index + 1])
})
pdf.context.lookup(outline).set(PDFName.of('First'), items[0])
pdf.context.lookup(outline).set(PDFName.of('Last'), items.at(-1))
pdf.catalog.set(PDFName.of('Outlines'), outline)
const bytes = await pdf.save()
await writeFile('tests/fixtures/paper.pdf', bytes)
await writeFile('src/renderer/public/sample.pdf', bytes)

const long = await PDFDocument.create()
long.setTitle('Long document rendering fixture')
const longFont = await long.embedFont(StandardFonts.Helvetica)
for (let i = 1; i <= 120; i++) {
  const p = long.addPage([595, 842])
  p.drawText(`Long document - page ${i}`, { x: 55, y: 735, size: 20, font: longFont })
  p.drawText('Searchable reading context on every page.', {
    x: 55,
    y: 690,
    size: 12,
    font: longFont,
  })
}
await writeFile('tests/fixtures/long.pdf', await long.save())
const scanCanvas = createCanvas(595, 842)
const scan = scanCanvas.getContext('2d')
scan.fillStyle = '#fffefa'
scan.fillRect(0, 0, 595, 842)
scan.fillStyle = '#313131'
scan.font = 'bold 24px serif'
scan.fillText('A scanned page', 55, 95)
scan.font = '14px serif'
for (let line = 0; line < 24; line++)
  scan.fillText(
    'This text is part of an image, with no searchable text layer.',
    55,
    145 + line * 23,
  )
const scanned = await PDFDocument.create()
scanned.setTitle('Scanned document fixture')
const scanImage = await scanned.embedPng(scanCanvas.toBuffer('image/png'))
scanned.addPage([595, 842]).drawImage(scanImage, { x: 0, y: 0, width: 595, height: 842 })
await writeFile('tests/fixtures/scanned.pdf', await scanned.save())
await writeFile('tests/fixtures/invalid.pdf', 'This is not a PDF.')

// Minimal Standard Security Handler (revision 2) fixture, user password: read.
const padding = Buffer.from(
  '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
  'hex',
)
const md5 = (data) => createHash('md5').update(data).digest()
const pad = (value) => Buffer.concat([Buffer.from(value, 'latin1'), padding]).subarray(0, 32)
function rc4(key, input) {
  const state = Array.from({ length: 256 }, (_, i) => i)
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + key[i % key.length]) & 255
    ;[state[i], state[j]] = [state[j], state[i]]
  }
  let i = 0
  j = 0
  return Buffer.from(
    [...input].map((byte) => {
      i = (i + 1) & 255
      j = (j + state[i]) & 255
      ;[state[i], state[j]] = [state[j], state[i]]
      return byte ^ state[(state[i] + state[j]) & 255]
    }),
  )
}
const owner = rc4(md5(pad('owner')).subarray(0, 5), pad('read'))
const identifier = md5(Buffer.from('margin-pdf-fixture'))
const permissions = Buffer.alloc(4)
permissions.writeInt32LE(-4)
const key = md5(Buffer.concat([pad('read'), owner, permissions, identifier])).subarray(0, 5)
const user = rc4(key, padding)
const objectKey = (number) => {
  const suffix = Buffer.alloc(5)
  suffix.writeUIntLE(number, 0, 3)
  return md5(Buffer.concat([key, suffix])).subarray(0, 10)
}
const encryptedStream = rc4(
  objectKey(4),
  Buffer.from('BT /F1 24 Tf 55 730 Td (Password protected paper) Tj ET'),
)
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  Buffer.concat([
    Buffer.from(`<< /Length ${encryptedStream.length} >>\nstream\n`),
    encryptedStream,
    Buffer.from('\nendstream'),
  ]),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`,
]
const parts = [Buffer.from('%PDF-1.4\n')]
const offsets = [0]
let length = parts[0].length
objects.forEach((object, index) => {
  offsets.push(length)
  const chunk = Buffer.concat([
    Buffer.from(`${index + 1} 0 obj\n`),
    Buffer.isBuffer(object) ? object : Buffer.from(object),
    Buffer.from('\nendobj\n'),
  ])
  parts.push(chunk)
  length += chunk.length
})
const xref = `xref\n0 7\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
  .join(
    '',
  )}trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [<${identifier.toString('hex')}> <${identifier.toString('hex')}>] >>\nstartxref\n${length}\n%%EOF\n`
await writeFile('tests/fixtures/password.pdf', Buffer.concat([...parts, Buffer.from(xref)]))
