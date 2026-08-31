import { test, expect, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const SCRATCH = '/private/tmp/claude-501/-Users-moham-Desktop-fyp/9f1badaf-b850-435c-b805-9a4bc574cb5c/scratchpad'
const REPORT_DIR = path.join(SCRATCH, 'reports')
const SCREENSHOT_DIR = path.join(REPORT_DIR, 'screenshots')
const RESULTS_JSON = path.join(REPORT_DIR, 'results.json')

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
if (!fs.existsSync(RESULTS_JSON)) fs.writeFileSync(RESULTS_JSON, '[]')

const IMAGES = [
  { id: 1, file: 'img-1.jpeg', species: 'Tridax procumbens (Coatbuttons)' },
  { id: 2, file: 'img-2.jpeg', species: 'Ageratina/Chromolaena mistflower (194x259)' },
  { id: 3, file: 'img-3.jpeg', species: 'Taraxacum (dandelion)' },
  { id: 4, file: 'img-4.jpeg', species: 'Sankowsky palm (ornamental)' },
  { id: 5, file: 'img-5.jpeg', species: 'Mimosa pigra / bipinnate legume' },
  { id: 6, file: 'img-6.jpeg', species: 'Dicranopteris linearis (Resam)' },
  { id: 7, file: 'img-7.jpeg', species: 'Eichhornia crassipes (water hyacinth)' },
]

function appendResult(row: Record<string, unknown>) {
  const cur = JSON.parse(fs.readFileSync(RESULTS_JSON, 'utf8')) as unknown[]
  cur.push(row)
  fs.writeFileSync(RESULTS_JSON, JSON.stringify(cur, null, 2))
}

async function preparePage(page: Page) {
  await page.goto('http://localhost:5174/')
  await page.getByRole('button', { name: /Start privately/i }).click()
  await expect(page.getByRole('heading', { name: /Save your recovery information/i })).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => document.querySelector<HTMLInputElement>('input[type=checkbox]')?.click())
  await page.getByRole('button', { name: /Continue to InvaTrace/i }).click()
  await expect(page).toHaveURL(/\/map/, { timeout: 15_000 })
}

async function runImage(page: Page, group: 'with_exif' | 'stripped', img: typeof IMAGES[number]) {
  const filePath = path.join(SCRATCH, group === 'with_exif' ? 'images-with-exif' : 'images-stripped', img.file)
  const row: Record<string, unknown> = {
    id: img.id, file: img.file, group, species_hint: img.species,
    quality_ok: false, quality_message: '', outcome_badge: 'n/a',
    species_shown: 'n/a', confidence: 'n/a', status_uncertain: false,
    report_button_visible: false, error: '',
  }
  const screenshotName = `${group}__img-${img.id}.png`
  row.screenshot = screenshotName

  try {
    await page.goto('http://localhost:5174/scan', { waitUntil: 'domcontentloaded' })
    const camInput = page.locator('input[type=file][aria-label="Take photo"]')
    await camInput.waitFor({ state: 'attached', timeout: 20_000 })
    await camInput.setInputFiles(filePath)

    // Wait for quality outcome text.
    await page.waitForFunction(() => /Photo quality check passed|Could not process|too low|too blurry|too large|Unsupported|Try another photo/i.test(document.body.innerText), { timeout: 40_000 })
    const bodyEarly = await page.locator('body').innerText()
    if (/Photo quality check passed/i.test(bodyEarly)) {
      row.quality_ok = true
      row.quality_message = 'Photo quality check passed'
    } else {
      const m = bodyEarly.match(/(Could not process[^\n]*|too low[^\n]*|too blurry[^\n]*|too large[^\n]*|Unsupported[^\n]*|Try another photo[^\n]*)/i)
      row.quality_message = m?.[0] ?? 'unknown quality failure'
    }

    if (row.quality_ok) {
      await page.getByRole('button', { name: /Analyse plant/i }).click()
      try {
        await page.waitForURL(/\/scan\/result/, { timeout: 60_000 })
        // Let the guidance panel finish rendering.
        await page.waitForTimeout(500)
        const body = await page.locator('body').innerText()
        const badge = body.match(/(Invasive species detected|Not a target species|Uncertain[^\n]*)/i)
        row.outcome_badge = badge?.[0] ?? 'unknown'
        const sp = body.match(/^([A-Z][a-z]+\s+[a-z]+)$/m)
        row.species_shown = sp?.[1] ?? '—'
        const conf = body.match(/Confidence[\s\S]{0,80}?(\d{1,3})\s*%/)
        row.confidence = conf ? conf[1] + '%' : 'n/a'
        row.status_uncertain = /Status uncertain/.test(body)
        row.report_button_visible = /Report sighting/.test(body)
      } catch (e) {
        row.outcome_badge = 'analysis timeout'
        row.error = String(e).slice(0, 200)
      }
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, screenshotName), fullPage: true })
  } catch (e) {
    row.error = String(e).slice(0, 200)
    try { await page.screenshot({ path: path.join(SCREENSHOT_DIR, screenshotName), fullPage: true }) } catch {}
  }
  appendResult(row)
}

test.beforeEach(async ({ page }) => {
  await preparePage(page)
})

for (const img of IMAGES) {
  test(`with_exif img-${img.id} ${img.species}`, async ({ page }) => {
    await runImage(page, 'with_exif', img)
  })
  test(`stripped img-${img.id} ${img.species}`, async ({ page }) => {
    await runImage(page, 'stripped', img)
  })
}
