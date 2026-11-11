import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  publicDir: false,
  build: {
    outDir: 'extensions/vscode/dist/media',
    emptyOutDir: true,
    lib: {
      entry: resolve('extensions/vscode/webview/main.tsx'),
      formats: ['es'],
      fileName: () => 'reader.js',
      cssFileName: 'reader',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
    chunkSizeWarningLimit: 2500,
  },
})
