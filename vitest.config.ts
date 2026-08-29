import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Only files beside source modules are unit tests. Complete browser journeys
  // live in e2e/ and are run separately by Playwright.
  test: { environment: 'node', include: ['src/**/*.test.ts?(x)'] },
})
