import { defineConfig, devices } from '@playwright/test'

/** Browser contract smoke test against the Compose backend. The backend stack
 * must already be healthy; this config starts only the real-mode Vite client. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'real-backend.spec.ts',
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
    command: 'npm run dev:real',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
