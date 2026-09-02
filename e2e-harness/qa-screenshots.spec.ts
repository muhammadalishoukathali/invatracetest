// One-off screenshot capture tool, not a real test suite — every test here
// exists to produce a labelled PNG in Downloads for showing progress to a
// supervisor or dropping into the FYP writeup, not to assert correctness.
// Covers the main screens across desktop and mobile widths plus the report
// wizard, so keep the numbering in the filenames roughly in flow order.
import { test, expect, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const OUT = '/Users/moham/Downloads/InvaTrace QA Screenshots'
fs.mkdirSync(OUT, { recursive: true })

async function bootstrap(page: Page) {
  await page.goto('http://localhost:5173/')
  await page.getByRole('button', { name: /Start privately/i }).click()
  await expect(page.getByRole('heading', { name: /Save your recovery information/i })).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => document.querySelector<HTMLInputElement>('input[type=checkbox]')?.click())
  await page.getByRole('button', { name: /Continue to InvaTrace/i }).click()
  await expect(page).toHaveURL(/\/map/, { timeout: 15_000 })
  await page.waitForTimeout(2500)
}

// Same fake-green-blob trick as the overflow audit — lets the flow reach
// scan/result without a real photo, since the point here is capturing UI
// states, not testing classification accuracy.
async function uploadSyntheticGreen(page: Page) {
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 500; c.height = 500
    const g = c.getContext('2d')!
    g.fillStyle = '#2a7a3a'; g.fillRect(0, 0, 500, 500)
    g.fillStyle = '#88cc44'; g.beginPath(); g.arc(250, 250, 140, 0, Math.PI * 2); g.fill()
    const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'))
    const file = new File([blob], 'test.png', { type: 'image/png' })
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type=file]')
    // Prefer the gallery (dev-only) input so we prove the QA-unlock works.
    const input = inputs[1] || inputs[0]
    const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(1500)
}

test.describe.configure({ mode: 'serial' })

test('01 desktop map — no filters / no bell / OSM tiles / trimmed sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await bootstrap(page)
  await page.screenshot({ path: path.join(OUT, '01-desktop-map.png'), fullPage: false })
})

test('02 mobile map — bottom nav = Map + Scan / OSM tiles', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await bootstrap(page)
  await page.screenshot({ path: path.join(OUT, '02-mobile-map.png'), fullPage: false })
})

test('03 sighting details sheet — trimmed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await bootstrap(page)
  await page.locator('.map-pin').first().click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(OUT, '03-sighting-sheet.png'), fullPage: false })
})

test('04 scan result — target identified, gallery unlocked report', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await bootstrap(page)
  await page.goto('http://localhost:5173/scan')
  await page.waitForTimeout(600)
  await uploadSyntheticGreen(page)
  await page.getByRole('button', { name: /Analyse plant/i }).click()
  await page.waitForURL(/\/scan\/result/, { timeout: 15_000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(OUT, '04-scan-result-top.png'), fullPage: false })
  // Scroll for guidance panel
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.scan-flow__main')
    if (el) el.scrollTop = el.scrollHeight * 0.35
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT, '05-guidance-default-protected.png'), fullPage: false })
  // Click "I have explicit permission"
  await page.evaluate(() => {
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[type=radio]')]
    const explicit = radios.find((r) => /explicit|have permission|authorised/i.test(r.closest('label')?.textContent || ''))
    explicit?.click()
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT, '06-guidance-explicit-permission.png'), fullPage: false })
  // Scroll to bottom — sources + status record + report button
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.scan-flow__main')
    if (el) el.scrollTop = el.scrollHeight
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT, '07-status-record-and-report-button.png'), fullPage: false })
  // Open Safety policy & sources
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => ((d as HTMLDetailsElement).open = true))
    const el = document.querySelector<HTMLElement>('.scan-flow__main')
    if (el) el.scrollTop = el.scrollHeight
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT, '08-sources-panel-no-accessed-date.png'), fullPage: false })
})

test('09 report page reached from gallery upload (proves DEV unlock)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await bootstrap(page)
  await page.goto('http://localhost:5173/scan')
  await page.waitForTimeout(600)
  await uploadSyntheticGreen(page)
  await page.getByRole('button', { name: /Analyse plant/i }).click()
  await page.waitForURL(/\/scan\/result/, { timeout: 15_000 })
  await page.getByRole('button', { name: /Report sighting/i }).click()
  await expect(page).toHaveURL(/\/report/, { timeout: 8_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(OUT, '09-report-wizard-opened.png'), fullPage: false })
})

// Deliberately skips bootstrapIdentity() here — we want the recovery kit
// screen itself, before the "continue" click that normally routes past it.
test('10 recovery kit screen — 10 codes, ack checkbox', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('http://localhost:5173/')
  await page.getByRole('button', { name: /Start privately/i }).click()
  await expect(page.getByRole('heading', { name: /Save your recovery information/i })).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT, '10-recovery-kit.png'), fullPage: false })
})
