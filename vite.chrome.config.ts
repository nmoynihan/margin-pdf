import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve('extensions/chrome'),
  base: './',
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: resolve('extensions/chrome/dist'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        viewer: resolve('extensions/chrome/viewer.html'),
        welcome: resolve('extensions/chrome/welcome.html'),
      },
    },
    chunkSizeWarningLimit: 2500,
  },
})
