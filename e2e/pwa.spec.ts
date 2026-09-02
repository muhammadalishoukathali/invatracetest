import { expect, test } from '@playwright/test'

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
