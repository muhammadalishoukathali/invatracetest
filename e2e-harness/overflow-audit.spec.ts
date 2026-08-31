import { test, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const OUT = '/Users/moham/Downloads/InvaTrace Overflow Audit'
fs.mkdirSync(OUT, { recursive: true })

const VIEWPORTS = [
  { name: 'mobile-320', width: 320, height: 780 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'desktop-1280', width: 1280, height: 800 },
] as const

interface Overflow {
  viewport: string
  route: string
  scrollWidth: number
  clientWidth: number
  overflowPx: number
  offendingSelectors: string[]
  screenshot: string
}
const findings: Overflow[] = []

const REPORT_JSON = path.join(OUT, 'report.json')
if (!fs.existsSync(REPORT_JSON)) fs.writeFileSync(REPORT_JSON, '[]')

function appendFinding(f: Overflow) {
  const cur = JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8')) as Overflow[]
  cur.push(f)
  fs.writeFileSync(REPORT_JSON, JSON.stringify(cur, null, 2))
}

async function bootstrap(page: Page) {
  await page.goto('http://localhost:5173/')
  await page.getByRole('button', { name: /Start privately/i }).click()
  const heading = page.getByRole('heading', { name: /Save your recovery information/i })
  await heading.waitFor({ state: 'visible', timeout: 15_000 })
  await page.evaluate(() => document.querySelector<HTMLInputElement>('input[type=checkbox]')?.click())
  await page.getByRole('button', { name: /Continue to InvaTrace/i }).click()
  await page.waitForURL(/\/map/, { timeout: 15_000 })
  await page.waitForTimeout(800)
}

async function uploadSyntheticGreen(page: Page) {
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
  await page.waitForURL(/\/scan\/result/, { timeout: 15_000 })
  await page.waitForTimeout(600)
}

async function checkOverflow(page: Page, viewport: typeof VIEWPORTS[number], route: string, label: string) {
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement
    const body = document.body
    // Find every child element wider than the viewport.
    const bad: string[] = []
    const vw = window.innerWidth
    const walk = (el: Element) => {
      const rect = el.getBoundingClientRect()
      if (rect.right > vw + 1 && rect.width > 0 && rect.height > 0) {
        const tag = el.tagName.toLowerCase()
        const cls = (el.className && typeof el.className === 'string')
          ? '.' + el.className.split(/\s+/).slice(0, 2).join('.')
          : ''
        const id = el.id ? '#' + el.id : ''
        const label = `${tag}${id}${cls} — right ${Math.round(rect.right)}px > vw ${vw}px`
        if (!bad.some((b) => b.startsWith(`${tag}${id}${cls}`))) bad.push(label)
      }
      if (bad.length > 12) return
      for (const child of Array.from(el.children)) walk(child)
    }
    walk(body)
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      innerWidth: window.innerWidth,
      offending: bad.slice(0, 8),
    }
  })
  const overflowPx = metrics.scrollWidth - metrics.clientWidth
  const shot = path.join(OUT, `${viewport.name}__${label}.png`)
  await page.screenshot({ path: shot, fullPage: false })
  if (overflowPx > 1) {
    const finding: Overflow = {
      viewport: viewport.name,
      route,
      scrollWidth: metrics.scrollWidth,
      clientWidth: metrics.clientWidth,
      overflowPx,
      offendingSelectors: metrics.offending,
      screenshot: path.basename(shot),
    }
    appendFinding(finding)
    console.log(`OVERFLOW ${viewport.name} ${route} (${overflowPx}px):`, metrics.offending)
  } else {
    console.log(`OK ${viewport.name} ${route} (0px)`)
  }
}

test.describe.configure({ mode: 'serial' })

for (const vp of VIEWPORTS) {
  test(`overflow audit @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await bootstrap(page)

    // /map — with pins loaded
    await page.goto('http://localhost:5173/map')
    await page.waitForTimeout(1200)
    await checkOverflow(page, vp, '/map', '01-map')

    // Open a sighting sheet — force-click bypasses actionability check when
    // pins overlap at the current zoom level. If no pin, skip silently.
    const pin = page.locator('.map-pin').first()
    if (await pin.count()) {
      await pin.click({ force: true, timeout: 5_000 }).catch(() => {})
      await page.waitForTimeout(800)
      if (await page.locator('.pin-sheet').count()) {
        await checkOverflow(page, vp, '/map (sheet)', '02-map-sheet')
        const close = page.getByRole('button', { name: /Close sighting details/i })
        if (await close.count()) await close.click({ force: true }).catch(() => {})
        await page.waitForTimeout(300)
      }
    }

    // /scan capture screen (empty state)
    await page.goto('http://localhost:5173/scan')
    await page.waitForTimeout(600)
    await checkOverflow(page, vp, '/scan', '03-scan-empty')

    // /scan/result with target Mikania (mock hits target for solid-green bucket)
    await uploadSyntheticGreen(page)
    await checkOverflow(page, vp, '/scan/result (target)', '04-scan-result-target')

    // scroll down for guidance panel + sources + status chip
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.scan-flow__main')
      if (el) el.scrollTop = el.scrollHeight * 0.55
    })
    await page.waitForTimeout(400)
    await checkOverflow(page, vp, '/scan/result (guidance)', '05-scan-result-guidance')

    await page.evaluate(() => {
      document.querySelectorAll('details').forEach((d) => ((d as HTMLDetailsElement).open = true))
      const el = document.querySelector<HTMLElement>('.scan-flow__main')
      if (el) el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(400)
    await checkOverflow(page, vp, '/scan/result (bottom + sources)', '06-scan-result-sources')

    // /report wizard
    await page.getByRole('button', { name: /Report sighting/i }).click()
    await page.waitForURL(/\/report/, { timeout: 8_000 })
    await page.waitForTimeout(500)
    await checkOverflow(page, vp, '/report', '07-report-location')

    // /access identity management
    await page.goto('http://localhost:5173/access')
    await page.waitForTimeout(600)
    await checkOverflow(page, vp, '/access', '08-access')

    // /private-access/restore
    await page.goto('http://localhost:5173/private-access/restore')
    await page.waitForTimeout(500)
    await checkOverflow(page, vp, '/private-access/restore', '09-restore')

    // /private-access landing
    await page.goto('http://localhost:5173/private-access')
    await page.waitForTimeout(500)
    await checkOverflow(page, vp, '/private-access', '10-landing')
  })
}
