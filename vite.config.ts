import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// Enable an in-memory self-signed cert whenever `VITE_HTTPS=true` is set.
// Browsers block `getUserMedia` on non-localhost origins over plain http, so a
// phone or projector viewing the dev server via its LAN IP (`http://192.168…`)
// cannot open the camera. Serving over https via this plugin unblocks that path
// without adding a certificate to the OS trust store.
const httpsEnabled = process.env.VITE_HTTPS === 'true'

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
    ...(httpsEnabled ? [basicSsl()] : []),
    VitePWA({
      // autoUpdate so a fresh deploy always wins over a stale cached shell —
      // prompt-based updates silently strand demo laptops on an old build.
      registerType: 'autoUpdate',
      includeAssets: ['invatrace-logo-192.png', 'invatrace-logo-512.png'],
      manifest: {
        name: 'InvaTrace',
        short_name: 'InvaTrace',
        description: 'Invasive plant monitoring and trail recovery',
        theme_color: '#1B7A50',
        background_color: '#F4F6F3',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'invatrace-logo-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'invatrace-logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'invatrace-logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
          {
            // Cache raster map tiles so the map keeps working offline once a
            // reporter has panned an area. Bounded per-cache size prevents
            // unbounded disk use as reporters roam.
            urlPattern: ({ url }) =>
              /\.(png|jpg|jpeg|webp|pbf)$/.test(url.pathname) &&
              (url.hostname.endsWith('tile.openstreetmap.org') ||
                url.hostname.endsWith('openfreemap.org') ||
                url.hostname.endsWith('maptiler.com') ||
                url.hostname.endsWith('stadiamaps.com') ||
                url.hostname.endsWith('basemaps.cartocdn.com')),
            handler: 'CacheFirst',
            options: {
              cacheName: 'invatrace-map-tiles',
              expiration: { maxEntries: 800, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
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
