import { createCanvas } from '@napi-rs/canvas'
import { mkdir, writeFile } from 'node:fs/promises'

await mkdir('resources', { recursive: true })
function png(size) {
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  ctx.scale(size / 512, size / 512)
  ctx.fillStyle = '#477568'
  ctx.beginPath()
  ctx.roundRect(0, 0, 512, 512, 108)
  ctx.fill()
  ctx.strokeStyle = '#eff6f1'
  ctx.lineWidth = 17
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(165, 105)
  ctx.lineTo(295, 105)
  ctx.lineTo(373, 183)
  ctx.lineTo(373, 400)
  ctx.lineTo(165, 400)
  ctx.closePath()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(295, 105)
  ctx.lineTo(295, 187)
  ctx.lineTo(373, 187)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(213, 259)
  ctx.lineTo(321, 259)
  ctx.moveTo(213, 309)
  ctx.lineTo(299, 309)
  ctx.stroke()
  ctx.globalAlpha = 0.6
  ctx.lineWidth = 14
  ctx.beginPath()
  ctx.moveTo(115, 156)
  ctx.lineTo(115, 449)
  ctx.lineTo(324, 449)
  ctx.stroke()
  return canvas.toBuffer('image/png')
}
const large = png(1024)
await writeFile('resources/icon.png', png(512))
const icoPng = png(256)
const icoHeader = Buffer.alloc(22)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(1, 4)
icoHeader.writeUInt16LE(1, 10)
icoHeader.writeUInt16LE(32, 12)
icoHeader.writeUInt32LE(icoPng.length, 14)
icoHeader.writeUInt32LE(22, 18)
await writeFile('resources/icon.ico', Buffer.concat([icoHeader, icoPng]))
const chunks = [
  [large, 'ic10'],
  [png(512), 'ic09'],
].map(([data, type]) => {
  const header = Buffer.alloc(8)
  header.write(type, 0)
  header.writeUInt32BE(data.length + 8, 4)
  return Buffer.concat([header, data])
})
const icnsHeader = Buffer.alloc(8)
icnsHeader.write('icns')
icnsHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
await writeFile('resources/icon.icns', Buffer.concat([icnsHeader, ...chunks]))
