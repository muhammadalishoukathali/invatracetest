// Targets verify-unsupported-target.spec.ts on the model-test server (5174)
// — presumably the check for how the app handles a photo of something
// outside the target species list. Note: that spec file isn't present in
// this directory right now, so this config currently has nothing to run.
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: HERE,
  testMatch: 'verify-unsupported-target.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, reporter: 'list', timeout: 90_000,
  use: { baseURL: 'http://localhost:5174', trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
