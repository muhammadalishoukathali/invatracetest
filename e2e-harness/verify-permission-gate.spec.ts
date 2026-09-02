// Verification script for the permission radio gate on the scan-result page.
// The guidance panel is supposed to stay hidden until the user picks an
// answer, then show exactly one of two mutually exclusive blocks — this was
// a bug-prone spot early on (both blocks rendering, or neither), so it gets
// its own targeted checks plus screenshots for each of the three states.
import { test, expect, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const OUT = '/Users/moham/Downloads/InvaTrace QA Screenshots'
fs.mkdirSync(OUT, { recursive: true })

async function bootstrapAndScan(page: Page) {
  await page.goto('http://localhost:5173/')
  await page.getByRole('button', { name: /Start privately/i }).click()
  await expect(page.getByRole('heading', { name: /Save your recovery information/i })).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => document.querySelector<HTMLInputElement>('input[type=checkbox]')?.click())
  await page.getByRole('button', { name: /Continue to InvaTrace/i }).click()
  await expect(page).toHaveURL(/\/map/, { timeout: 15_000 })

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

// Scrolls the inner scan-flow panel (not the window) down to wherever the
// permission question currently sits — its position shifts depending on how
// much guidance text is above it, so we search by text instead of a fixed
// offset.
async function scrollToPermissionGate(page: Page) {
  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('.scan-flow__main')
    if (!container) return
    const question = [...container.querySelectorAll<HTMLElement>('*')]
      .find((el) => /permission to act at this site/i.test(el.textContent || '') && el.children.length < 8)
    if (!question) return
    const containerRect = container.getBoundingClientRect()
    const questionRect = question.getBoundingClientRect()
    container.scrollTop += (questionRect.top - containerRect.top) - 40
  })
  await page.waitForTimeout(400)
}

test('permission gate: no guidance block until user picks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await bootstrapAndScan(page)

  const body = await page.locator('body').innerText()
  // Default state: neither block should be rendered — but the pick prompt is.
  expect(body).not.toContain('If protected or permission is unknown')
  expect(body).toContain('Pick one of the options above')

  await scrollToPermissionGate(page)
  await page.screenshot({ path: path.join(OUT, '13-permission-none.png'), fullPage: false })
})

test('permission gate: choosing "protected" reveals only the protected block', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await bootstrapAndScan(page)

  await page.evaluate(() => {
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[type=radio]')]
    const protectedRadio = radios.find((r) => /protected|unknown/i.test(r.closest('label')?.textContent || ''))
    protectedRadio?.click()
  })
  await page.waitForTimeout(400)

  const body = await page.locator('body').innerText()
  expect(body).toContain('If protected or permission is unknown')
  expect(body).not.toContain('Only on an authorised site')

  await scrollToPermissionGate(page)
  await page.screenshot({ path: path.join(OUT, '14-permission-protected.png'), fullPage: false })
})

test('permission gate: choosing "explicit permission" reveals only the authorised path', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await bootstrapAndScan(page)

  await page.evaluate(() => {
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[type=radio]')]
    const explicit = radios.find((r) => /explicit|have permission|authorised/i.test(r.closest('label')?.textContent || ''))
    explicit?.click()
  })
  await page.waitForTimeout(400)

  const body = await page.locator('body').innerText()
  expect(body).not.toContain('If protected or permission is unknown')

  await scrollToPermissionGate(page)
  await page.screenshot({ path: path.join(OUT, '15-permission-explicit.png'), fullPage: false })
})
