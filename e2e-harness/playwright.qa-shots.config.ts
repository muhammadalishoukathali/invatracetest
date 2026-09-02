// Targets qa-screenshots.spec.ts, the plain screenshot-capture script, on
// the mocked dev server (5173). Its own config mainly so it's a one-command
// re-run whenever I need fresh screenshots for the writeup.
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: HERE,
  testMatch: 'qa-screenshots.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, reporter: 'list', timeout: 120_000,
  use: { baseURL: 'http://localhost:5173', trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
