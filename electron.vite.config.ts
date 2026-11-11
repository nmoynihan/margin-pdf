import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { productionCSP } from './src/main/security'
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
    plugins: [
      react(),
      {
        name: 'reader-csp',
        transformIndexHtml(html, context) {
          const policy = context.server
            ? productionCSP.replace(
                "connect-src 'self'",
                "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
              )
            : productionCSP
          // frame-ancestors is enforced by the production response header.
          return html.replace('__READER_CSP__', policy.replace("; frame-ancestors 'none'", ''))
        },
      },
    ],
    build: { chunkSizeWarningLimit: 1500 },
  },
})
