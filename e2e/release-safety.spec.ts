import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

// Pre-release checks that don't fit neatly under one feature: making sure the
// consent-gated report guidance can't be seen before the user actually picks
// a land-permission option, and that the core pages don't overflow
// horizontally on a small phone screen or a normal desktop.

async function startPrivateAccess(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /Start privately/i }).click()
  await expect(page.getByRole('heading', { name: /Save your recovery kit/i }))
    .toBeVisible({ timeout: 15_000 })
  await page.locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: /Continue to InvaTrace/i }).click()
  await expect(page).toHaveURL(/\/map$/, { timeout: 15_000 })
}

async function chooseSyntheticGalleryPhoto(page: Page) {
  await page.goto('/scan')
  await page.locator('input[aria-label="Choose photo from gallery"]')
    .setInputFiles(path.join(process.cwd(), 'public/reference-images/mikania_micrantha.jpg'))
  await expect(page.getByText('Photo quality check passed')).toBeVisible({ timeout: 8_000 })
  await page.getByRole('button', { name: /Analyse plant/i }).click()
  await expect(page).toHaveURL(/\/scan\/result$/, { timeout: 15_000 })
}

// The permission guidance text carries legal/safety info, so it should only
// appear once the user has picked an option — not shown by default, and not
// showing the other option's text at the same time as this one's.
test('gallery scans can be reported and reveal guidance only after a permission choice', async ({ page }) => {
  await startPrivateAccess(page)
  await chooseSyntheticGalleryPhoto(page)

  await expect(page.getByRole('button', { name: /Report sighting/i })).toBeVisible()
  await expect(page.getByText('Choose one option above to see what you can safely do here.')).toBeVisible()
  await expect(page.getByText('Protected land or no permission')).toHaveCount(0)
  await expect(page.getByText('If the land manager has approved it')).toHaveCount(0)

  await page.getByRole('radio', { name: /protected land, or I am not sure/i }).check()
  await expect(page.getByText('Protected land or no permission')).toBeVisible()
  await expect(page.getByText('If the land manager has approved it')).toHaveCount(0)

  await page.getByRole('radio', { name: /permission from the land manager/i }).check()
  await expect(page.getByText('Protected land or no permission')).toHaveCount(0)
})

// Runs the same page-by-page overflow check at a small phone width and a
// desktop width — horizontal scroll is the kind of regression that's easy to
// miss by eye but breaks usability on a real device.
for (const viewport of [
  { name: 'small mobile', width: 320, height: 780 },
  { name: 'desktop', width: 1280, height: 800 },
]) {
  test(`critical pages fit the ${viewport.name} viewport`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await startPrivateAccess(page)

    for (const route of ['/map', '/reports', '/profile', '/scan']) {
      await page.goto(route)
      await expect.poll(async () => page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))).toEqual({
        clientWidth: viewport.width,
        scrollWidth: viewport.width,
      })
    }
  })
}
