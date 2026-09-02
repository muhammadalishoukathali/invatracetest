// Mobile-only check for the camera capture screen. Runs under the
// "mobile-chromium" Playwright project (Pixel 5 viewport) — that's the only
// project this spec is matched against. Guards against the camera staying on
// (battery drain, privacy risk) when the tab gets backgrounded mid-scan, and
// against layout overflow on a narrow screen.
import { expect, test, type Page } from '@playwright/test'

async function startPrivateAccess(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start privately' }).click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue to InvaTrace' }).click()
  await expect(page).toHaveURL(/\/map$/)
}

// Fires pagehide rather than a normal navigation, since that's the case most
// likely to leave a camera stream running if the cleanup logic isn't wired up
// properly (a real navigation would tear things down more predictably).
test('mobile scan stops the camera on interruption and stays within the viewport', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 480
        const stream = canvas.captureStream(5)
        Object.assign(window, { __testCameraStream: stream })
        return stream
      },
    })
  })
  await startPrivateAccess(page)
  await page.goto('/scan')
  await page.getByRole('button', { name: 'Open camera' }).click()
  await expect(page.getByRole('heading', { name: 'Frame one clear plant feature' })).toBeVisible()

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))

  await expect(page.getByText('Camera closed when the app was interrupted')).toBeVisible()
  const state = await page.evaluate(() => {
    const stream = (window as Window & { __testCameraStream: MediaStream }).__testCameraStream
    return {
      trackStates: stream.getTracks().map((track) => track.readyState),
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }
  })
  expect(state.trackStates).toEqual(['ended'])
  expect(state.documentWidth).toBeLessThanOrEqual(state.viewportWidth)
})
