// Targets known-species-harness.spec.ts (the clean-photo control group for
// the cluttered-species harness) on the model-test server, port 5174. Own
// config so this can be run and compared against the cluttered results
// without either spec's setup interfering with the other.
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: HERE,
  testMatch: 'known-species-harness.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'off', screenshot: 'off', video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
