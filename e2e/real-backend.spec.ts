import { expect, test } from '@playwright/test'

test('private access starts and bootstraps against the real API', async ({ page, request }) => {
  const health = await request.get('http://localhost:8000/health/live')
  expect(health.status()).toBe(200)
  expect(await health.json()).toEqual({ status: 'ok' })

  await page.goto('/')
  await expect(page).toHaveURL(/\/private-access$/)
  const started = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/profiles/start')
  await page.getByRole('button', { name: 'Start privately' }).click()
  const startResponse = await started
  expect(startResponse.status()).toBe(201)
  expect(startResponse.headers()['cache-control']).toContain('no-store')
  const created = await startResponse.json() as {
    profile: { id: string; role: string; trustLevel: string }
    recoveryCodes: string[]
  }
  expect(created.profile).toMatchObject({ role: 'Detector', trustLevel: 'New' })
  expect(created.recoveryCodes).toHaveLength(10)

  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue to InvaTrace' }).click()
  await expect(page).toHaveURL(/\/map$/)

  const bootstrap = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/profiles/bootstrap')
  await page.reload()
  const bootstrapped = await (await bootstrap).json() as {
    profile: { id: string }
    recoverySetupRequired: boolean
  }
  expect(bootstrapped.profile.id).toBe(created.profile.id)
  expect(bootstrapped.recoverySetupRequired).toBe(false)
  await expect(page.getByRole('heading', { name: 'Live threat map' })).toBeVisible()
})
