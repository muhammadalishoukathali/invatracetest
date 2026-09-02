// Confirms the production PWA actually installs a service worker and works
// offline. Has to run against the built preview server (npm run preview), not
// the Vite dev server, because service workers don't register the same way in
// dev mode. Uses playwright.pwa.config.ts (port 4173).
import { expect, test } from '@playwright/test'

// Also checks the service worker isn't caching profile/bootstrap responses —
// those carry session-specific data, so caching them could leak one visitor's
// session details into a later visit on the same device.
test('production shell installs, works offline, and does not cache private access requests', async ({ page, context }) => {
  await page.goto('/private-access')
  await expect(page.getByRole('heading', { name: 'Field reporting without a personal account.' })).toBeVisible()

  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifest).toBeTruthy()
  const manifestResponse = await page.request.get(new URL(manifest!, page.url()).href)
  expect(manifestResponse.ok()).toBe(true)
  expect((await manifestResponse.json()).name).toBe('InvaTrace')

  await page.evaluate(async () => navigator.serviceWorker.ready)
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)

  await page.evaluate(async () => {
    await fetch('/api/v1/profiles/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationToken: 'test-only' }),
    })
  })
  const cachedPrivateRequests = await page.evaluate(async () => {
    const keys = await caches.keys()
    const requests = await Promise.all(keys.map(async (key) => (await caches.open(key)).keys()))
    return requests.flat().filter((request) => new URL(request.url).pathname.startsWith('/api/v1/profiles')).length
  })
  expect(cachedPrivateRequests).toBe(0)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Field reporting without a personal account.' })).toBeVisible()
})
