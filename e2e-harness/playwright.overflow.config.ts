// Runs overflow-audit.spec.ts against the normal mocked dev server (5173).
// Longer timeout (180s) than the other configs because it walks ten routes
// across three viewport widths in a single serial test per viewport — a lot
// more page loads than the other harness specs do.
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: HERE,
  testMatch: 'overflow-audit.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, reporter: 'list', timeout: 180_000,
  use: { baseURL: 'http://localhost:5173', trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
