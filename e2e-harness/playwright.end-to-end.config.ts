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
