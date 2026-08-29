import { defineConfig, devices } from '@playwright/test'

/** Runs complete browser journeys against the Vite development server. During
 *  local work, Playwright reuses an existing server; continuous integration
 *  starts a fresh one. The mock service worker handles API calls in the page. */
export default defineConfig({
  testDir: './e2e',
  testIgnore: 'real-backend.spec.ts',
  // The development API keeps one shared mock session, so parallel tests could
  // change the same profile or recovery code at the same time.
  fullyParallel: false,
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
    {
      name: 'chromium',
      testIgnore: [
        '**/real-backend.spec.ts',
        '**/mobile-robustness.spec.ts',
        '**/model-ui-failure.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      testMatch: '**/mobile-robustness.spec.ts',
      use: { ...devices['Pixel 5'] },
    },
  ],
})
