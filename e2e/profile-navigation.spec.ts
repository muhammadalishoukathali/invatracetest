import { expect, test } from '@playwright/test'

test('leaving profile for records does not trap Back between the two pages', async ({ page }) => {
  await page.goto('/private-access')
  await page.getByRole('button', { name: 'Start privately' }).click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue to InvaTrace' }).click()
  await expect(page).toHaveURL(/\/map$/)

  await page.goto('/profile')
  await page.getByRole('link', { name: 'View my records' }).click()
  await expect(page).toHaveURL(/\/reports$/)

  await page.goBack()
  await expect(page).not.toHaveURL(/\/profile$/)
})

test('a saved record marker opens its record details from the map', async ({ page }) => {
  await page.goto('/private-access')
  await page.getByRole('button', { name: 'Start privately' }).click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue to InvaTrace' }).click()

  await page.evaluate(() => {
    localStorage.setItem('invatrace-scan-history-v1', JSON.stringify({
      version: 1,
      records: [{
        captureId: 'saved-map-record',
        observedAt: '2026-09-01T10:30:00.000Z',
        captureSource: 'camera',
        outcome: 'target',
        speciesId: 'mimosa-diplotricha',
        speciesName: 'Mimosa diplotricha',
        scientificName: 'Mimosa diplotricha',
        confidence: 0.94,
        modelVersion: 'test-model',
        reportable: true,
        location: { lat: 3.05936, lng: 101.61481 },
        locationAccuracyM: 12,
        recordedAt: '2026-09-01T10:30:00.000Z',
      }],
    }))
  })

  await page.goto('/reports')
  await page.getByRole('link', { name: 'View Mimosa diplotricha scan location on map' }).click()

  const marker = page.getByRole('button', { name: 'Open details for Mimosa diplotricha scan' })
  await expect(marker).toBeVisible()
  await marker.click()

  const details = page.getByRole('dialog', { name: 'Saved record details' })
  await expect(details).toBeVisible()
  await expect(details.locator('[data-dialog-initial]')).toBeFocused()
  await expect(details.getByRole('heading', { name: 'Mimosa diplotricha scan' })).toBeVisible()
  await expect(details.getByText('Not submitted', { exact: true })).toBeVisible()
  await expect(details.getByText('3.05936, 101.61481', { exact: true })).toBeVisible()
  await expect(details.getByText('±12 m', { exact: true })).toBeVisible()
  await details.getByRole('button', { name: 'Close saved record details' }).click()
  await expect(marker).toBeFocused()
})
