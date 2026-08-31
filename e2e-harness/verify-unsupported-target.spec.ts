import { test, expect } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const OUT = '/Users/moham/Downloads/InvaTrace QA Screenshots'
fs.mkdirSync(OUT, { recursive: true })

// Reproduces the user's exact original screenshot scenario: Asclepias
// curassavica is a real 31-class species with no SPECIES_DETAIL entry in the
// mock backend, so it renders UnsupportedTargetResult. This proves the old
// "PULIH model / seasonal / look-alike" copy is gone.
test('Asclepias curassavica — unsupported target shows real plant info, no PULIH text', async ({ page }) => {
  // 320x780 is the tightest common mobile viewport (iPhone SE 1st gen /
  // Chrome side panel / split-screen). If the chip wraps here, it wraps
  // everywhere.
  await page.setViewportSize({ width: 320, height: 780 })
  await page.goto('http://localhost:5174/')
  await page.getByRole('button', { name: /Start privately/i }).click()
  await expect(page.getByRole('heading', { name: /Save your recovery information/i })).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => document.querySelector<HTMLInputElement>('input[type=checkbox]')?.click())
  await page.getByRole('button', { name: /Continue to InvaTrace/i }).click()
  await expect(page).toHaveURL(/\/map/, { timeout: 15_000 })

  await page.goto('http://localhost:5174/scan')
  const camInput = page.locator('input[type=file][aria-label="Take photo"]')
  await camInput.waitFor({ state: 'attached', timeout: 20_000 })
  await camInput.setInputFiles('/Users/moham/Desktop/fyp/invatrace-web/public/reference-images/asclepias_curassavica.jpg')
  await expect(page.getByText('Photo quality check passed')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Analyse plant/i }).click()
  await expect(page).toHaveURL(/\/scan\/result/, { timeout: 30_000 })
  await page.waitForTimeout(800)

  const body = await page.locator('body').innerText()
  console.log('FULL RESULT TEXT:\n', body)

  expect(body).not.toContain('PULIH')
  expect(body).not.toContain('seasonal action guide')
  expect(body).not.toContain('look-alike guide')

  await page.screenshot({ path: path.join(OUT, '11-asclepias-unsupported-target.png'), fullPage: true })

  // Scroll to the "Malaysia plant guidance" status chip and screenshot that
  // region directly — this is the header that overflowed horizontally.
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h3')].find((h) => /Malaysia plant guidance/i.test(h.textContent || ''))
    heading?.scrollIntoView({ block: 'center' })
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, '12-status-chip-wrap-check.png'), fullPage: false })
})
