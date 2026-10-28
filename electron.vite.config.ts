import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } } },
  },
  renderer: {
    base: './',
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    plugins: [react()],
    build: { chunkSizeWarningLimit: 1500 },
  },
})
