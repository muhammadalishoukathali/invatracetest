// Manual QA script. This is the "control group" for the cluttered-species
// harness — same seven target species but clean, textbook single-plant
// photos instead of messy field shots. Comparing the two result sets tells
// me how much accuracy the model loses once backgrounds get busy. Runs
// against dev:model-test (port 5174) so it's hitting the real classifier,
// not the mock used by the main e2e suite.
import { test, expect, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const SCRATCH = '/private/tmp/claude-501/-Users-moham-Desktop-fyp/9f1badaf-b850-435c-b805-9a4bc574cb5c/scratchpad'
const IMG_DIR = path.join(SCRATCH, 'known-species')
const REPORT_DIR = path.join(SCRATCH, 'reports')
const SHOT_DIR = path.join(REPORT_DIR, 'known-screenshots')
const RESULTS_JSON = path.join(REPORT_DIR, 'known-results.json')

fs.mkdirSync(SHOT_DIR, { recursive: true })
if (!fs.existsSync(RESULTS_JSON)) fs.writeFileSync(RESULTS_JSON, '[]')

const IMAGES = [
  { id: 1, file: 'known-1_mikania_micrantha.jpg', species: 'Mikania micrantha' },
  { id: 2, file: 'known-2_mimosa_pigra.jpg', species: 'Mimosa pigra' },
  { id: 3, file: 'known-3_eichhornia_crassipes.jpg', species: 'Eichhornia crassipes' },
  { id: 4, file: 'known-4_chromolaena_odorata.jpg', species: 'Chromolaena odorata' },
  { id: 5, file: 'known-5_dicranopteris_linearis.jpg', species: 'Dicranopteris linearis' },
  { id: 6, file: 'known-6_ageratum_conyzoides.jpg', species: 'Ageratum conyzoides' },
  { id: 7, file: 'known-7_bidens_pilosa.jpg', species: 'Bidens pilosa' },
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

async function run(page: Page, img: typeof IMAGES[number]) {
  const filePath = path.join(IMG_DIR, img.file)
  const row: Record<string, unknown> = {
    id: img.id, file: img.file, expected: img.species,
    quality_ok: false, quality_message: '',
    outcome_badge: 'n/a', species_shown: 'n/a', confidence: 'n/a',
    status_uncertain: false, report_button_visible: false, error: '',
    screenshot: `known-${img.id}.png`,
  }
  try {
    await page.goto('http://localhost:5174/scan', { waitUntil: 'domcontentloaded' })
    const cam = page.locator('input[type=file][aria-label="Take photo"]')
    await cam.waitFor({ state: 'attached', timeout: 20_000 })
    await cam.setInputFiles(filePath)
    await page.waitForFunction(() => /Photo quality check passed|Could not process|too low|too blurry|too large|Unsupported|Try another photo/i.test(document.body.innerText), { timeout: 40_000 })
    const early = await page.locator('body').innerText()
    if (/Photo quality check passed/i.test(early)) {
      row.quality_ok = true
      row.quality_message = 'passed'
    } else {
      const m = early.match(/(Could not process[^\n]*|too low[^\n]*|too blurry[^\n]*|too large[^\n]*|Unsupported[^\n]*|Try another photo[^\n]*)/i)
      row.quality_message = m?.[0] ?? 'unknown fail'
    }
    if (row.quality_ok) {
      await page.getByRole('button', { name: /Analyse plant/i }).click()
      try {
        await page.waitForURL(/\/scan\/result/, { timeout: 60_000 })
        await page.waitForTimeout(800)
        const body = await page.locator('body').innerText()
        const badge = body.match(/(Invasive species detected|Not a target species|Uncertain[^\n]*)/i)
        row.outcome_badge = badge?.[0] ?? 'unknown'
        // Grab the top species heading — first h2 on the result page.
        const heading = await page.locator('h2').first().textContent().catch(() => null)
        row.species_shown = heading?.trim() || '—'
        const conf = body.match(/Confidence[\s\S]{0,80}?(\d{1,3})\s*%/)
        row.confidence = conf ? conf[1] + '%' : 'n/a'
        row.status_uncertain = /Status uncertain/.test(body)
        row.report_button_visible = /Report sighting/.test(body)
      } catch (e) {
        row.outcome_badge = 'analysis timeout'
        row.error = String(e).slice(0, 200)
      }
    }
    await page.screenshot({ path: path.join(SHOT_DIR, row.screenshot as string), fullPage: true })
  } catch (e) {
    row.error = String(e).slice(0, 200)
    try { await page.screenshot({ path: path.join(SHOT_DIR, row.screenshot as string), fullPage: true }) } catch {}
  }
  appendResult(row)
}

test.beforeEach(async ({ page }) => { await preparePage(page) })
for (const img of IMAGES) {
  test(`known ${img.id} ${img.species}`, async ({ page }) => { await run(page, img) })
}
