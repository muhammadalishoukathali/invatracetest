import { defineConfig, devices } from '@playwright/test'

/** Service-worker and offline-caching behaviour only shows up in a production
 *  build; Vite's dev server doesn't register a real service worker. So this
 *  runs against `npm run preview` (the built dist/ output) instead of the dev
 *  server the other configs use. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'pwa.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
