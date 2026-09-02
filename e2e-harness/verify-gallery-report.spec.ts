// Small one-off check: the gallery-upload path (as opposed to the camera
// input) is only enabled in dev builds, and it's easy for that dev-only
// wiring to silently break. This confirms uploading via gallery still gets
// you all the way to a working "Report sighting" button and the /report
// route — the thing that actually matters for demoing without a camera.
import { test, expect } from '@playwright/test'

test('gallery upload unlocks Report sighting button in DEV', async ({ page }) => {
  await page.goto('http://localhost:5173/')
  await page.getByRole('button', { name: /Start privately/i }).click()
  await expect(page.getByRole('heading', { name: /Save your recovery information/i })).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => document.querySelector<HTMLInputElement>('input[type=checkbox]')?.click())
  await page.getByRole('button', { name: /Continue to InvaTrace/i }).click()
  await expect(page).toHaveURL(/\/map/, { timeout: 15_000 })

  await page.goto('http://localhost:5173/scan')
  await expect(page.getByRole('button', { name: /Choose a photo instead/i })).toBeVisible({ timeout: 10_000 })

  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 500; c.height = 500
    const g = c.getContext('2d')!
    g.fillStyle = '#2a7a3a'; g.fillRect(0, 0, 500, 500)
    g.fillStyle = '#88cc44'; g.beginPath(); g.arc(250, 250, 140, 0, Math.PI * 2); g.fill()
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'))
    const file = new File([blob], 'test.png', { type: 'image/png' })
    const galleryInput = document.querySelector<HTMLInputElement>('input[aria-label="Choose photo from gallery"]')!
    const dt = new DataTransfer(); dt.items.add(file); galleryInput.files = dt.files
    galleryInput.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(page.getByText('Photo quality check passed')).toBeVisible({ timeout: 8_000 })
  await page.getByRole('button', { name: /Analyse plant/i }).click()
  await expect(page).toHaveURL(/\/scan\/result/, { timeout: 15_000 })

  const outcome = await page.locator('body').innerText()
  console.log('OUTCOME BADGE:', outcome.match(/(Invasive species detected|Not a target|Uncertain[^\n]*)/)?.[0])

  // The actual assertion this whole message chain is about.
  await expect(page.getByRole('button', { name: /Report sighting/i })).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: /Report sighting/i }).click()
  await expect(page).toHaveURL(/\/report/, { timeout: 8_000 })
})
