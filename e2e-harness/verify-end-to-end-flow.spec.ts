import { test, expect, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const OUT = '/Users/moham/Downloads/InvaTrace QA Screenshots'
fs.mkdirSync(OUT, { recursive: true })

test.describe.configure({ mode: 'serial' })

async function bootstrapIdentity(page: Page) {
  await page.goto('http://localhost:5173/')
  await page.getByRole('button', { name: /Start privately/i }).click()
  await expect(page.getByRole('heading', { name: /Save your recovery information/i })).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => document.querySelector<HTMLInputElement>('input[type=checkbox]')?.click())
  await page.getByRole('button', { name: /Continue to InvaTrace/i }).click()
  await expect(page).toHaveURL(/\/map/, { timeout: 15_000 })
}

async function scanTarget(page: Page) {
  await page.goto('http://localhost:5173/scan')
  await page.waitForTimeout(500)
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 500; c.height = 500
    const g = c.getContext('2d')!
    g.fillStyle = '#2a7a3a'; g.fillRect(0, 0, 500, 500)
    g.fillStyle = '#88cc44'; g.beginPath(); g.arc(250, 250, 140, 0, Math.PI * 2); g.fill()
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'))
    const file = new File([blob], 'test.png', { type: 'image/png' })
    const input = document.querySelectorAll<HTMLInputElement>('input[type=file]')[1]
      || document.querySelector<HTMLInputElement>('input[type=file]')!
    const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: /Analyse plant/i }).click()
  await expect(page).toHaveURL(/\/scan\/result/, { timeout: 15_000 })
  await page.waitForTimeout(800)
}

async function pickPermission(page: Page, choice: 'protected' | 'explicit') {
  await page.evaluate((c) => {
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[type=radio]')]
    const match = radios.find((r) => {
      const t = r.closest('label')?.textContent || ''
      return c === 'protected'
        ? /protected|unknown/i.test(t)
        : /explicit|have permission|authorised/i.test(t)
    })
    match?.click()
  }, choice)
  await page.waitForTimeout(300)
}

async function completeReportWizard(
  page: Page,
  context: { grantGeolocation: () => Promise<void> },
) {
  await context.grantGeolocation()
  await page.getByRole('button', { name: /Report sighting/i }).click()
  await expect(page).toHaveURL(/\/report/, { timeout: 8_000 })
  await page.waitForTimeout(600)

  // Location step: capture GPS
  const relocate = page.getByRole('button', { name: /Use my current location|Re-locate me/i })
  if (await relocate.count()) await relocate.click({ trial: false }).catch(() => {})
  // Wait for accuracy to be captured (the Continue button becomes enabled).
  await expect(page.getByRole('button', { name: /^Continue$/i })).toBeEnabled({ timeout: 10_000 })
  await page.getByRole('button', { name: /^Continue$/i }).click()

  // Extent step
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /^Continue$/i }).click()

  // Consent step — check both checkboxes then continue
  await page.waitForTimeout(400)
  await page.getByRole('checkbox', { name: /accurate/i }).check()
  await page.getByRole('checkbox', { name: /personal information/i }).check()
  await page.getByRole('button', { name: /Review submission|^Continue$/i }).click()

  // Preview → submit
  await page.waitForTimeout(400)
  const submit = page.getByRole('button', { name: /Submit report/i })
  await expect(submit).toBeEnabled({ timeout: 5_000 })
  await submit.click()

  // Success
  await expect(page.getByRole('heading', { name: /Report submitted/i })).toBeVisible({ timeout: 8_000 })
  const successBody = await page.locator('body').innerText()
  expect(successBody).toContain('Community report — not expert validated')
  expect(successBody).toMatch(/Reference:/i)
}

for (const choice of ['protected', 'explicit'] as const) {
  test(`end-to-end: identity → scan → guidance (${choice}) → report → tracking → map`, async ({ page, context }) => {
    await context.grantPermissions(['geolocation'], { origin: 'http://localhost:5173' })
    await context.setGeolocation({ latitude: 3.1497, longitude: 101.6412, accuracy: 15 })

    // Watch every /api/v1/reports POST so we can prove submission actually
    // reaches the backend.
    const reportPosts: Array<{ status: number; body: string }> = []
    page.on('response', async (r) => {
      if (r.url().endsWith('/api/v1/reports') && r.request().method() === 'POST') {
        try { reportPosts.push({ status: r.status(), body: await r.text() }) } catch {}
      }
    })

    await bootstrapIdentity(page)
    await scanTarget(page)
    await pickPermission(page, choice)

    // Structural assertion: the correct block is showing after the pick.
    const body = await page.locator('body').innerText()
    if (choice === 'protected') {
      expect(body).toContain('If protected or permission is unknown')
    } else {
      expect(body).not.toContain('If protected or permission is unknown')
    }

    await completeReportWizard(page, {
      grantGeolocation: async () => { /* already granted at context level */ },
    })

    // Backend received the report — status 200 (merged) or 201 (created) is fine.
    expect(reportPosts.length).toBeGreaterThanOrEqual(1)
    const first = reportPosts[0]
    expect([200, 201]).toContain(first.status)
    const parsed = JSON.parse(first.body) as { id: string; status: string }
    expect(parsed.id).toMatch(/^[0-9a-f-]{20,}$/)
    console.log(`REPORT SUBMITTED (${choice})`, { id: parsed.id, initialStatus: parsed.status })

    // Snapshot the success screen.
    await page.screenshot({ path: path.join(OUT, `16-report-submitted-${choice}.png`), fullPage: false })

    // Follow through to the tracking page — proves the "View screening status"
    // link actually reaches a real detail record.
    await page.getByRole('button', { name: /View screening status/i }).click()
    await expect(page).toHaveURL(new RegExp(`/reports/${parsed.id}`), { timeout: 8_000 })
    // Wait for the mock's 750ms rules pipeline to flip status → screened.
    await expect(page.getByRole('heading', { name: /Report published/i })).toBeVisible({ timeout: 8_000 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(OUT, `17-tracking-${choice}.png`), fullPage: false })
  })
}
