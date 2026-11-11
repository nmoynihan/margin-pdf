import { createCanvas, loadImage } from '@napi-rs/canvas'
import { mkdir, writeFile } from 'node:fs/promises'

await mkdir('dist/chrome-store', { recursive: true })
const icon = await loadImage('resources/branding/margin-pdf-mark.png')
for (const [name, width, height] of [
  ['small-promo', 440, 280],
  ['marquee-promo', 1400, 560],
]) {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  const scale = width / 440
  context.fillStyle = '#f2f5f1'
  context.fillRect(0, 0, width, height)
  const iconSize = Math.min(height * 0.28, 150)
  context.drawImage(icon, (width - iconSize) / 2, height * 0.12, iconSize, iconSize)
  context.textAlign = 'center'
  context.fillStyle = '#283e35'
  context.font = `600 ${Math.min(32 * scale, 66)}px sans-serif`
  context.fillText('Margin PDF', width / 2, height * 0.57)
  context.font = `${Math.min(16 * scale, 30)}px sans-serif`
  context.fillStyle = '#477568'
  context.fillText('Keep your place. Follow the idea.', width / 2, height * 0.72)
  context.font = `${Math.min(12 * scale, 22)}px sans-serif`
  context.fillText('Link previews  ·  Split panes  ·  Private by design', width / 2, height * 0.85)
  await writeFile(`dist/chrome-store/${name}.png`, canvas.toBuffer('image/png'))
}
