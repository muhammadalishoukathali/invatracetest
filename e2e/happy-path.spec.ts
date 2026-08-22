import { test, expect } from '@playwright/test'

/**
 * Golden path: guest → scan → target result → report → submitted.
 * Uses a synthetic in-page image so the file picker never opens; MSW handles
 * every API call from `/api/v1/profiles/bootstrap` through
 * `/api/v1/reports`.
 */
test('guest can scan, analyse, and submit a report', async ({ page }) => {
  await page.goto('/auth/sign-in')

  await page.getByRole('button', { name: 'Continue without an account' }).click()
  await expect(page).toHaveURL(/\/map$/)

  /* Navigate to the scan flow via the app FAB / sidebar button. */
  await page.getByRole('button', { name: /Scan a plant|New scan/ }).first().click()
  await expect(page).toHaveURL(/\/scan$/)

  /* Inject a synthetic JPEG onto the hidden file input so Analyse enables. */
  await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 400; c.height = 400
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#2a7a3a'; ctx.fillRect(0, 0, 400, 400)
    ctx.fillStyle = '#88cc44'
    ctx.beginPath(); ctx.arc(200, 200, 120, 0, Math.PI * 2); ctx.fill()
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.85))
    const file = new File([blob], 'test.jpg', { type: 'image/jpeg' })
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    const dt = new DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })

  await expect(page.getByText('Photo quality check passed')).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: /Analyse plant/ }).click()

  await expect(page).toHaveURL(/\/scan\/result$/, { timeout: 5000 })
  await expect(page.getByRole('heading', { name: 'Mikania micrantha' })).toBeVisible()
  await expect(page.getByText('stub-v0.1.0')).toBeVisible()

  await page.getByRole('button', { name: /Report sighting/ }).click()
  await expect(page).toHaveURL(/\/report$/)

  /* Location: enter manual coords instead of prompting for geolocation. */
  await page.getByText('Enter coordinates manually').click()
  await page.getByLabel('Latitude').fill('3.1497')
  await page.getByLabel('Longitude').fill('101.6412')
  await page.getByRole('button', { name: 'Apply coordinates' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()

  /* Extent: accept default (small_patch) and continue. */
  await page.getByRole('button', { name: 'Continue' }).click()

  /* Consent: tick both. */
  await page.getByRole('checkbox', { name: /accurate/i }).check()
  await page.getByRole('checkbox', { name: /personal information/i }).check()
  await page.getByRole('button', { name: 'Review submission' }).click()

  /* Preview → submit. */
  await expect(page.getByText('Mikania-Micrantha')).toBeVisible()
  await page.getByRole('button', { name: 'Submit report' }).click()

  await expect(page.getByRole('heading', { name: 'Report submitted' }))
    .toBeVisible({ timeout: 8000 })
  await expect(page.getByText('Tracking ID')).toBeVisible()
})

test('detector cannot reach /verify (role gate)', async ({ page }) => {
  await page.goto('/auth/sign-in')
  await page.getByRole('button', { name: 'Continue without an account' }).click()
  await expect(page).toHaveURL(/\/map$/)

  /* Direct navigation should bounce back to /map. */
  await page.goto('/verify')
  await expect(page).toHaveURL(/\/map$/)
})

test('threat map shows pins and ODbL attribution', async ({ page }) => {
  await page.goto('/auth/sign-in')
  await page.getByRole('button', { name: 'Continue without an account' }).click()
  await expect(page).toHaveURL(/\/map$/)

  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap')
  await expect(page.locator('.map-pin').first()).toBeVisible({ timeout: 5000 })
})
