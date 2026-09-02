import { defineConfig, devices } from '@playwright/test'

/** Covers the scan screen's behaviour when the on-device model fails to
 *  download partway through. The spec itself fakes the failing fetch; this
 *  config just needs a clean, isolated server on its own port (`dev:model-test`,
 *  a real-model dev build) so that mocking doesn't race the main e2e suite. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'model-ui-failure.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev:model-test',
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
