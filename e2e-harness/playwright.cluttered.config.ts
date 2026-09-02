// Points only at cluttered-species-harness.spec.ts and targets port 5174 —
// the dev:model-test server, which runs the real classifier instead of the
// mocked API the main config uses. Kept separate so it doesn't get swept up
// by a normal e2e run and doesn't need the mock service worker wired in.
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: HERE,
  testMatch: 'cluttered-species-harness.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, reporter: 'list', timeout: 120_000,
  use: { baseURL: 'http://localhost:5174', trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
