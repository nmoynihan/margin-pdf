import { createCanvas, loadImage } from '@napi-rs/canvas'
import { mkdir, writeFile } from 'node:fs/promises'

await mkdir('resources', { recursive: true })
// Keep the generated master as the source; builds only resize and encode it.
const master = await loadImage('resources/branding/margin-pdf-icon-master.png')
function png(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(master, 0, 0, size, size)
  return canvas.toBuffer('image/png')
}

await writeFile('resources/margin-pdf-icon.png', png(512))

// An ICO directory entry uses zero for a 256-pixel dimension.
const icoPng = png(256)
const icoHeader = Buffer.alloc(22)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(1, 4)
icoHeader.writeUInt16LE(1, 10)
icoHeader.writeUInt16LE(32, 12)
icoHeader.writeUInt32LE(icoPng.length, 14)
icoHeader.writeUInt32LE(22, 18)
await writeFile('resources/margin-pdf-icon.ico', Buffer.concat([icoHeader, icoPng]))

const chunks = [
  [1024, 'ic10'],
  [512, 'ic09'],
  [256, 'ic08'],
  [128, 'ic07'],
  [64, 'ic12'],
  [32, 'ic11'],
  [16, 'icp4'],
].map(([size, type]) => {
  const data = png(size)
  const header = Buffer.alloc(8)
  header.write(type, 0)
  header.writeUInt32BE(data.length + 8, 4)
  return Buffer.concat([header, data])
})
const icnsHeader = Buffer.alloc(8)
icnsHeader.write('icns')
icnsHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
await writeFile('resources/margin-pdf-icon.icns', Buffer.concat([icnsHeader, ...chunks]))
