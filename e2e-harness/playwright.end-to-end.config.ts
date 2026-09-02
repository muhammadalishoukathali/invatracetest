// Drives verify-end-to-end-flow.spec.ts against the normal mocked dev
// server (5173, same port as the main config) rather than the model-test
// server. Isolated into its own config just so this one long journey spec
// can be run on its own without pulling in the rest of /e2e.
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: HERE,
  testMatch: 'verify-end-to-end-flow.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, reporter: 'list', timeout: 90_000,
  use: { baseURL: 'http://localhost:5173', trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
