import { defineConfig, devices } from '@playwright/test'

/** Playwright config for InvaTrace end-to-end tests.
 *  Vite dev server is started fresh per test run (webServer.reuseExistingServer
 *  keeps local iteration fast). MSW handles all API calls in-process. */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,       // MSW's mock session is process-global — avoid races
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
