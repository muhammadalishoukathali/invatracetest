// Targets verify-permission-gate.spec.ts on the mocked dev server (5173).
// Split out into its own config so the permission-gate checks can be
// re-run quickly on their own while poking at that part of the UI, without
// waiting on the rest of the harness suite.
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: HERE,
  testMatch: 'verify-permission-gate.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, reporter: 'list', timeout: 60_000,
  use: { baseURL: 'http://localhost:5173', trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
