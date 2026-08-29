import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // Prebundle MapLibre into a self-contained worker. Without this, its worker
  // can import Vite browser modules that require `window` or `document`, which
  // makes the worker fail and leaves the map blank during development.
  optimizeDeps: {
    include: ['maplibre-gl'],
    // ONNX Runtime resolves its WASM file relative to its ESM bundle. Vite's
    // development pre-bundler rewrites that URL into an HTML fallback path.
    exclude: ['onnxruntime-web/webgpu'],
  },
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
          // Browsers can scale this SVG for the installed-app icon. PNG versions
          // can be added later if a platform requires fixed raster sizes.
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            // The validated PULIH ONNX artifact is split into sub-25 MiB chunks
            // for Cloudflare Pages, then reassembled and checksum-verified by
            // the browser adapter. Cache each complete response for offline use.
            urlPattern: ({ url }) => url.pathname.startsWith('/models/pulih-model1-v4/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'invatrace-pulih-model-v4',
              expiration: { maxEntries: 12, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // The hashed runtime is large, so cache it after first inference
            // instead of slowing service-worker installation with a precache.
            urlPattern: ({ url }) => /\/assets\/ort-wasm-.+\.wasm$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'invatrace-onnx-runtime',
              expiration: { maxEntries: 2, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Private-access and recovery traffic contains installation credentials
            // or one-time secrets and must never enter Cache Storage.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/v1/profiles'),
            handler: 'NetworkOnly',
            method: 'GET',
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/v1/profiles'),
            handler: 'NetworkOnly',
            method: 'POST',
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/v1/profiles'),
            handler: 'NetworkOnly',
            method: 'PATCH',
          },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    // MapLibre ships as one self-contained module. It is loaded only with the
    // map route, so keep it in a clearly named chunk and set the warning limit
    // just above its measured size. Other unexpectedly large chunks still warn.
    chunkSizeWarningLimit: 1050,
    rollupOptions: {
      output: {
        manualChunks: { 'map-engine': ['maplibre-gl'] },
      },
    },
  },
  server: { port: 5173 },
})
