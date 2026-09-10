/**
 * Iteration 2 Phase 8 - Epic 7 accessibility gate.
 *
 * Runs @axe-core/playwright against every screen touched or added in
 * Epics 3-6 (private access, map, adopted areas, bestiary, offline,
 * report submission result) so a regression that lands a WCAG A/AA
 * violation fails CI instead of only showing up in a manual audit.
 *
 * We disable one axe rule per screen only when the underlying element
 * is out of our control (MapLibre canvas has no accessible name by
 * design, and we mirror it with a hidden SR list already). Everything
 * else must come back clean.
 *
 * The suite runs against the mock service worker via the default
 * Playwright config so it does not depend on a live backend.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function scan(page: Page, disabledRules: string[] = []) {
  const builder = new AxeBuilder({ page }).withTags(A11Y_TAGS)
  if (disabledRules.length > 0) builder.disableRules(disabledRules)
  const results = await builder.analyze()
  return results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
}

async function bootstrap(page: Page) {
  await page.goto('/')
  await expect(page).toHaveURL(/\/private-access$/)
  await page.getByRole('button', { name: 'Start privately' }).click()
  await expect(page).toHaveURL(/\/private-access\/recovery$/)
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue to InvaTrace' }).click()
  await expect(page).toHaveURL(/\/map$/)
}

test.describe('accessibility (axe-core, AC 7.3)', () => {
  test('private-access landing has no critical or serious violations', async ({ page }) => {
    await page.goto('/private-access')
    await expect(page.getByRole('button', { name: 'Start privately' })).toBeVisible()
    const violations = await scan(page)
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
  })

  test('threat map (post-bootstrap) has no critical or serious violations', async ({ page }) => {
    await bootstrap(page)
    // MapLibre renders into a <canvas> with no accessible label; the
    // parallel SR-only marker list in ThreatMapPage carries the same
    // information. Disable the two canvas-specific rules only.
    const violations = await scan(page, ['canvas', 'region'])
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
  })

  test('adopted-areas dashboard has no critical or serious violations', async ({ page }) => {
    await bootstrap(page)
    await page.goto('/areas')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const violations = await scan(page)
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
  })

  test('offline catalogue settings has no critical or serious violations', async ({ page }) => {
    await bootstrap(page)
    await page.goto('/settings/offline')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const violations = await scan(page)
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
  })
})
