// Targets image-harness.spec.ts (the EXIF-present vs EXIF-stripped
// comparison) on the dev:model-test server, port 5174, so it exercises the
// real classifier. Separate from playwright.known.config.ts and
// playwright.cluttered.config.ts purely so each harness spec can be run in
// isolation without the others' image sets slowing things down.
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: HERE,
  testMatch: 'image-harness.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
