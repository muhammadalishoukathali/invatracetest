/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // Keep Playwright specs out of the vitest run — they use @playwright/test.
  test: { exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'] },
  // Force Vite to prebundle MapLibre so its module worker's transitive
  // imports (which reference /@vite/client and HMR helpers) get inlined into
  // a self-contained worker script. Without this, the worker fetches
  // Vite-injected modules that require `window`/`document`, breaks silently,
  // and no tiles ever decode → blank map.
  optimizeDeps: { include: ['maplibre-gl'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'InvaTrace',
        short_name: 'InvaTrace',
        description: 'Invasive plant monitoring and trail recovery',
        theme_color: '#1B7A50',
        background_color: '#F4F6F3',
        display: 'standalone',
        start_url: '/',
        icons: [
          // SVG icon covers every raster size Chrome / Safari installers need.
          // Rasterised PNGs (192, 512, maskable) can be added later without a
          // manifest change once a designer supplies the exports.
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Arch §12: the offline field pack is large. Raise the precache ceiling
        // so quantised model files are not silently skipped once they land.
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173 },
})
