// Checks how the scan UI behaves when the model download fails. Runs under
// playwright.model.config.ts, which spins up its own dev server on :5174 —
// it needs a clean environment so the fetch mocking here reliably fakes the
// download failure without racing other specs. Guards against losing the
// user's photo or letting them navigate onto a stale result screen when
// analysis gets interrupted.
import { expect, test, type Page } from '@playwright/test'

async function startPrivateAccess(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start privately' }).click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue to InvaTrace' }).click()
  await expect(page).toHaveURL(/\/map$/)
}

async function attachTestPhoto(page: Page) {
  await page.goto('/scan')
  await expect(page.getByRole('heading', { name: 'Photograph a clear plant feature' })).toBeVisible()
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const context = canvas.getContext('2d')!
    context.fillStyle = '#2a7a3a'
    context.fillRect(0, 0, 512, 512)
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((result) => resolve(result!), 'image/jpeg', 0.85)
    })
    const file = new File([blob], 'plant.jpg', { type: 'image/jpeg' })
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(page.getByText('Photo quality check passed')).toBeVisible()
}

// If analysis fails, the user shouldn't have to retake the photo — it needs
// to still be there when they hit Analyse again.
test('a model download failure keeps the photo available for retry', async ({ page }) => {
  await page.addInitScript(() => {
    const realFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return url.endsWith('.part-000')
        ? Promise.resolve(new Response('temporary test failure', { status: 503 }))
        : realFetch(input, init)
    }
  })
  await startPrivateAccess(page)
  await attachTestPhoto(page)
  await page.getByRole('button', { name: 'Analyse plant' }).click()

  await expect(page.getByText('Plant analysis could not finish')).toBeVisible()
  await expect(page.getByAltText('Captured plant')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Analyse plant' })).toBeEnabled()
  await expect(page).toHaveURL(/\/scan$/)
})

// Regression test for a timing bug: the user backs out mid-analysis, then the
// stalled download finally resolves after they've already left the page. That
// late response shouldn't be able to shove them onto the result screen. The
// __releaseModelDownload hook lets the test hold the fetch open and resolve
// it on demand instead of racing a real timeout.
test('leaving an interrupted analysis cannot navigate back to a stale result', async ({ page }) => {
  await page.addInitScript(() => {
    const realFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!url.endsWith('.part-000')) return realFetch(input, init)
      return new Promise<Response>((resolve) => {
        Object.assign(window, {
          __releaseModelDownload: () => resolve(new Response('interrupted', { status: 503 })),
        })
      })
    }
  })
  await startPrivateAccess(page)
  await attachTestPhoto(page)
  await page.getByRole('button', { name: 'Analyse plant' }).click()
  await page.waitForFunction(() => '__releaseModelDownload' in window)

  await page.getByRole('button', { name: 'Go back' }).click()
  await expect(page).toHaveURL(/\/map$/)
  await page.evaluate(() => {
    const release = (window as Window & { __releaseModelDownload: () => void }).__releaseModelDownload
    release()
  })
  await page.waitForTimeout(250)

  await expect(page).toHaveURL(/\/map$/)
  await expect(page.getByRole('heading', { name: 'Live threat map' })).toBeVisible()
})
