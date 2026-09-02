import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'

const BOOTSTRAP_PATH = '/api/v1/profiles/bootstrap'
const START_PATH = '/api/v1/profiles/start'
const RESTORE_PATH = '/api/v1/profiles/restore'
const FORBIDDEN_ACCOUNT_ENDPOINTS = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/logout',
]

async function readStoredIdentity(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('invatrace-identity', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<{
        schemaVersion: number
        installationToken: string
        createdAt: string
        profileId: string | null
      }>((resolve, reject) => {
        const request = db.transaction('identity', 'readonly').objectStore('identity').get('current')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally {
      db.close()
    }
  })
}

async function serializedBrowserStorage(page: Page) {
  return page.evaluate(async () => {
    const databases: unknown[] = []
    const cacheEntries: unknown[] = []
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name!, info.version)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        for (const storeName of Array.from(db.objectStoreNames)) {
          const values = await new Promise<unknown[]>((resolve, reject) => {
            const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
          databases.push({ database: info.name, store: storeName, values })
        }
      } finally {
        db.close()
      }
    }
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName)
      for (const request of await cache.keys()) {
        const response = await cache.match(request)
        cacheEntries.push({
          cacheName,
          method: request.method,
          url: request.url,
          requestHeaders: Array.from(request.headers.entries()),
          responseHeaders: response ? Array.from(response.headers.entries()) : [],
          apiResponseBody: response && new URL(request.url).pathname.startsWith('/api/')
            ? await response.clone().text()
            : null,
        })
      }
    }
    return JSON.stringify({
      localStorage: Object.entries(localStorage),
      sessionStorage: Object.entries(sessionStorage),
      databases,
      cacheEntries,
    }, (_key, value) => value instanceof Blob ? '[Blob]' : value)
  })
}

async function queuedReportCount(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('invatrace', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = db.transaction('report-queue', 'readonly').objectStore('report-queue').count()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally {
      db.close()
    }
  })
}

async function clearStoredIdentity(page: Page) {
  await page.evaluate(async () => {
    const request = indexedDB.deleteDatabase('invatrace-identity')
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Identity database deletion was blocked.'))
    })
  })
}

async function startPrivateAccess(page: Page, acknowledge = true) {
  await page.goto('/')
  await expect(page).toHaveURL(/\/private-access$/)
  const started = page.waitForResponse((response) => new URL(response.url()).pathname === START_PATH)
  await page.getByRole('button', { name: 'Start privately' }).click()
  const payload = await (await started).json() as {
    accessToken: string
    profile: { id: string; role: string; trustLevel: string }
    recoveryCodes: string[]
  }
  await expect(page).toHaveURL(/\/private-access\/recovery$/)
  await expect(page.getByRole('heading', { name: 'Save your recovery kit' })).toBeVisible()
  if (acknowledge) {
    await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
    await page.getByRole('button', { name: 'Continue to InvaTrace' }).click()
    await expect(page).toHaveURL(/\/map$/)
  }
  return payload
}

test.skip('legacy: fresh launch created a stable pseudonymous installation automatically', async ({ page }) => {
  const bootstrapBodies: Array<{ installationToken: string }> = []
  const accountEndpointCalls: string[] = []
  const requestedUrls: string[] = []
  const consoleMessages: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    requestedUrls.push(request.url())
    if (request.url().endsWith(BOOTSTRAP_PATH)) bootstrapBodies.push(request.postDataJSON())
    if (FORBIDDEN_ACCOUNT_ENDPOINTS.includes(path)) accountEndpointCalls.push(path)
  })
  page.on('console', (message) => consoleMessages.push(message.text()))

  const firstBootstrap = page.waitForResponse((response) => response.url().endsWith(BOOTSTRAP_PATH))
  await page.goto('/')
  const firstPayload = await (await firstBootstrap).json() as {
    accessToken: string
    profile: { id: string; role: string; trustLevel: string }
  }
  await expect(page).toHaveURL(/\/map$/)
  await expect(page.getByRole('heading', { name: 'Live threat map' })).toBeVisible()

  await expect(page.locator([
    'input[type="email"]',
    'input[type="password"]',
    'input[name="username"]',
    'input[autocomplete="username"]',
  ].join(', '))).toHaveCount(0)
  const visibleCopy = await page.locator('body').innerText()
  expect(visibleCopy).not.toMatch(/sign in|sign out|create an? account|continue without an account|password|email/i)
  expect(accountEndpointCalls).toEqual([])

  const stored = await readStoredIdentity(page)
  expect(stored.schemaVersion).toBe(1)
  expect(stored.installationToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(stored.profileId).toBe(firstPayload.profile.id)
  expect(firstPayload.profile).toMatchObject({ role: 'Detector', trustLevel: 'New' })
  expect(bootstrapBodies[0].installationToken).toBe(stored.installationToken)

  const secondBootstrap = page.waitForResponse((response) => response.url().endsWith(BOOTSTRAP_PATH))
  await page.reload()
  const secondPayload = await (await secondBootstrap).json() as typeof firstPayload
  await expect(page).toHaveURL(/\/map$/)

  expect(bootstrapBodies[1].installationToken).toBe(stored.installationToken)
  expect(secondPayload.profile.id).toBe(firstPayload.profile.id)

  const storage = await serializedBrowserStorage(page)
  expect(storage).not.toContain(firstPayload.accessToken)
  expect(storage).not.toContain(secondPayload.accessToken)
  expect(storage).toContain(stored.installationToken)

  const renderedHtml = await page.locator('html').evaluate((element) => element.outerHTML)
  for (const token of [stored.installationToken, firstPayload.accessToken, secondPayload.accessToken]) {
    expect(page.url()).not.toContain(token)
    expect(requestedUrls.join('\n')).not.toContain(token)
    expect(consoleMessages.join('\n')).not.toContain(token)
    expect(renderedHtml).not.toContain(token)
  }
})

test.skip('legacy: entry URLs redirected directly to the map', async ({ page }) => {
  const accountEndpointCalls: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (FORBIDDEN_ACCOUNT_ENDPOINTS.includes(path)) accountEndpointCalls.push(path)
  })

  const accountPaths = [
    '/auth', '/auth/sign-in', '/auth/create', '/auth/login', '/auth/register',
    '/login', '/signin', '/sign-in', '/register', '/signup', '/sign-up',
    '/create-account', '/forgot-password', '/reset-password', '/logout',
  ]
  for (const path of accountPaths) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/map$/)
    await expect(page.locator('input[type="email"], input[type="password"], input[name="username"]'))
      .toHaveCount(0)
  }
  expect(accountEndpointCalls).toEqual([])
})

test.skip('legacy: browser contexts automatically received installation tokens', async ({ browser }) => {
  const firstContext = await browser.newContext({ baseURL: 'http://localhost:5173' })
  const secondContext = await browser.newContext({ baseURL: 'http://localhost:5173' })
  try {
    const firstPage = await firstContext.newPage()
    const secondPage = await secondContext.newPage()
    await Promise.all([firstPage.goto('/'), secondPage.goto('/')])
    await Promise.all([
      expect(firstPage).toHaveURL(/\/map$/),
      expect(secondPage).toHaveURL(/\/map$/),
    ])

    await Promise.all([
      expect.poll(async () => (await readStoredIdentity(firstPage)).profileId).not.toBeNull(),
      expect.poll(async () => (await readStoredIdentity(secondPage)).profileId).not.toBeNull(),
    ])

    const [firstIdentity, secondIdentity] = await Promise.all([
      readStoredIdentity(firstPage),
      readStoredIdentity(secondPage),
    ])
    expect(firstIdentity.installationToken).not.toBe(secondIdentity.installationToken)
    expect(firstIdentity.profileId).not.toBe(secondIdentity.profileId)
  } finally {
    await Promise.all([firstContext.close(), secondContext.close()])
  }
})

test.skip('legacy: concurrent first-launch tabs automatically created identity', async ({ context, page }) => {
  const secondPage = await context.newPage()
  const firstBootstrap = page.waitForResponse((response) => response.url().endsWith(BOOTSTRAP_PATH))
  const secondBootstrap = secondPage.waitForResponse((response) => response.url().endsWith(BOOTSTRAP_PATH))
  await Promise.all([page.goto('/'), secondPage.goto('/')])
  const [firstSession, secondSession] = await Promise.all([
    firstBootstrap.then((response) => response.json()) as Promise<{ accessToken: string }>,
    secondBootstrap.then((response) => response.json()) as Promise<{ accessToken: string }>,
  ])
  await Promise.all([
    expect(page).toHaveURL(/\/map$/),
    expect(secondPage).toHaveURL(/\/map$/),
    expect.poll(async () => (await readStoredIdentity(page)).profileId).not.toBeNull(),
    expect.poll(async () => (await readStoredIdentity(secondPage)).profileId).not.toBeNull(),
  ])

  const [firstIdentity, secondIdentity] = await Promise.all([
    readStoredIdentity(page),
    readStoredIdentity(secondPage),
  ])
  expect(firstIdentity.installationToken).toBe(secondIdentity.installationToken)
  expect(firstIdentity.profileId).toBe(secondIdentity.profileId)

  const sessionStatuses = await Promise.all([
    page.evaluate(async (accessToken) => (await fetch('/api/v1/reports/mine', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })).status, firstSession.accessToken),
    secondPage.evaluate(async (accessToken) => (await fetch('/api/v1/reports/mine', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })).status, secondSession.accessToken),
  ])
  expect(sessionStatuses).toEqual([200, 200])
})

test.skip('legacy: first-ever offline launch created a provisional identity', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__invatraceOnline', {
      value: false,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(Navigator.prototype, 'onLine', {
      configurable: true,
      get() {
        return (window as unknown as { __invatraceOnline: boolean }).__invatraceOnline
      },
    })
  })

  const bootstrapBodies: Array<{ installationToken: string }> = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === BOOTSTRAP_PATH) {
      bootstrapBodies.push(request.postDataJSON())
    }
  })

  await page.goto('/')
  await expect(page).toHaveURL(/\/map$/)
  await expect(page.getByText(/You're offline/)).toBeVisible()
  const firstIdentity = await readStoredIdentity(page)
  expect(firstIdentity.profileId).toBeNull()
  expect(bootstrapBodies).toEqual([])

  await page.reload()
  await expect(page).toHaveURL(/\/map$/)
  const reloadedIdentity = await readStoredIdentity(page)
  expect(reloadedIdentity.installationToken).toBe(firstIdentity.installationToken)
  expect(bootstrapBodies).toEqual([])

  const bootstrapResponse = page.waitForResponse((response) => response.url().endsWith(BOOTSTRAP_PATH))
  await page.evaluate(() => {
    ;(window as unknown as { __invatraceOnline: boolean }).__invatraceOnline = true
    window.dispatchEvent(new Event('online'))
  })
  const payload = await (await bootstrapResponse).json() as { profile: { id: string } }
  expect(bootstrapBodies[0].installationToken).toBe(firstIdentity.installationToken)
  await expect.poll(async () => (await readStoredIdentity(page)).profileId).toBe(payload.profile.id)
})

test.skip('legacy: bootstrap created profiles while ignoring privilege fields', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/map$/)

  const result = await page.evaluate(async () => {
    const response = await fetch('/api/v1/profiles/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationToken: 'C'.repeat(43),
        role: 'Admin',
        trustLevel: 'Steward',
      }),
    })
    const payload = await response.json() as {
      accessToken: string
      profile: { role: string; trustLevel: string }
    }
    const privilegedResponse = await fetch('/api/v1/verify/queue', {
      headers: { Authorization: `Bearer ${payload.accessToken}` },
    })
    return {
      profile: payload.profile,
      privilegedStatus: privilegedResponse.status,
    }
  })

  expect(result.profile).toMatchObject({ role: 'Detector', trustLevel: 'New' })
  expect(result.privilegedStatus).toBe(403)
  await page.goto('/verify')
  await expect(page).toHaveURL(/\/map$/)
})

test('private access creation saves a recovery kit, skips the optional name, and bootstraps later', async ({ page }) => {
  const payload = await startPrivateAccess(page, false)
  expect(payload.profile).toMatchObject({ role: 'Detector', trustLevel: 'New' })
  expect(payload.recoveryCodes).toHaveLength(10)
  await expect(page.locator('.recovery-code-grid code')).toHaveCount(10)
  await expect(page.getByLabel('Display name (optional)')).toHaveValue('')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download recovery kit' }).click()
  expect((await download).suggestedFilename()).toBe(`invatrace-recovery-kit-${payload.profile.id}.txt`)

  const storageBeforeLeaving = await serializedBrowserStorage(page)
  for (const code of payload.recoveryCodes) expect(storageBeforeLeaving).not.toContain(code)
  expect(storageBeforeLeaving).not.toContain(payload.accessToken)

  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue to InvaTrace' }).click()
  await expect(page).toHaveURL(/\/map$/)
  const identity = await readStoredIdentity(page)
  expect(identity).toMatchObject({ schemaVersion: 2, profileId: payload.profile.id, recoverySetupComplete: true })

  const bootstrap = page.waitForResponse((response) => new URL(response.url()).pathname === BOOTSTRAP_PATH)
  await page.reload()
  const bootstrapped = await (await bootstrap).json() as { profile: { id: string }; recoverySetupRequired: boolean }
  expect(bootstrapped.profile.id).toBe(payload.profile.id)
  expect(bootstrapped.recoverySetupRequired).toBe(false)
  await expect(page).toHaveURL(/\/map$/)
  await expect(page.locator('input[type="email"], input[type="password"]')).toHaveCount(0)
})

test('restoration adds an installation, consumes codes once, rotates batches, and supports revocation', async ({ page }) => {
  const started = await startPrivateAccess(page)
  const firstIdentity = await readStoredIdentity(page)
  await clearStoredIdentity(page)
  await page.reload()
  await expect(page).toHaveURL(/\/private-access$/)
  await page.getByRole('link', { name: 'Restore existing access' }).click()
  await page.getByLabel('Public profile ID').fill(started.profile.id)
  await page.getByLabel('One recovery code').fill(started.recoveryCodes[0])
  const restoredResponse = page.waitForResponse((response) => new URL(response.url()).pathname === RESTORE_PATH)
  await page.getByRole('button', { name: 'Restore access' }).click()
  expect((await restoredResponse).status()).toBe(200)
  await expect(page).toHaveURL(/\/map$/)

  await page.goto('/access')
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByRole('heading', { name: 'My profile', level: 1 })).toBeVisible()
  await expect(page.locator('.installation-list > li')).toHaveCount(2)
  await expect(page.getByText('Current', { exact: true })).toBeVisible()

  const indistinguishable = await page.evaluate(async ({ profileId, usedCode }) => {
    const token = () => {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    }
    const attempt = async (id: string, code: string) => {
      const response = await fetch('/api/v1/profiles/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: id, recoveryCode: code, installationToken: token() }),
      })
      return { status: response.status, body: await response.text() }
    }
    return Promise.all([
      attempt(profileId, usedCode),
      attempt('IVT-NOT-A-PROFILE', 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GG'),
    ])
  }, { profileId: started.profile.id, usedCode: started.recoveryCodes[0] })
  expect(indistinguishable[0]).toEqual(indistinguishable[1])

  await page.getByRole('button', { name: 'Replace codes' }).click()
  await page.getByRole('button', { name: 'Replace codes' }).click()
  await expect(page.locator('.replacement-batch .recovery-code-grid code')).toHaveCount(10)
  const replacementCodes = await page.locator('.replacement-batch .recovery-code-grid code').allTextContents()

  const oldCodeStatus = await page.evaluate(async ({ profileId, oldCode }) => {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const installationToken = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    return (await fetch('/api/v1/profiles/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, recoveryCode: oldCode, installationToken }),
    })).status
  }, { profileId: started.profile.id, oldCode: started.recoveryCodes[1] })
  expect(oldCodeStatus).toBe(400)

  const concurrentStatuses = await page.evaluate(async ({ profileId, code }) => {
    const token = () => {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    }
    const restore = (installationToken: string) => fetch('/api/v1/profiles/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, recoveryCode: code, installationToken }),
    }).then((response) => response.status)
    return Promise.all([restore(token()), restore(token())])
  }, { profileId: started.profile.id, code: replacementCodes[0] })
  expect(concurrentStatuses.sort()).toEqual([200, 400])

  await page.getByRole('button', { name: 'Revoke' }).first().click()
  await page.getByRole('button', { name: 'Yes, revoke' }).click()
  await expect(page.locator('.installation-list > li')).toHaveCount(2)
  const revokedBootstrap = await page.evaluate(async (installationToken) => {
    const response = await fetch('/api/v1/profiles/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationToken }),
    })
    return { status: response.status, body: await response.json() }
  }, firstIdentity.installationToken)
  expect(revokedBootstrap).toMatchObject({ status: 401, body: { code: 'installation_revoked' } })
})

test('interrupted recovery setup rotates the unseen batch after reload', async ({ page }) => {
  const started = await startPrivateAccess(page, false)
  const bootstrap = page.waitForResponse((response) => new URL(response.url()).pathname === BOOTSTRAP_PATH)
  const rotation = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/recovery-codes/rotate'))
  await page.reload()
  expect((await bootstrap).headers()['cache-control']).toBe('no-store')
  const replacement = await (await rotation).json() as { recoveryCodes: string[] }
  await expect(page).toHaveURL(/\/private-access\/recovery$/)
  expect(replacement.recoveryCodes).toHaveLength(10)
  expect(replacement.recoveryCodes[0]).not.toBe(started.recoveryCodes[0])
  await expect(page.getByText(started.recoveryCodes[0])).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue to InvaTrace' }).click()
  await expect(page).toHaveURL(/\/map$/)
})

test('a first-ever offline launch explains the network requirement without creating a profile', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false })
  })
  await page.goto('/')
  await expect(page).toHaveURL(/\/private-access$/)
  await expect(page.getByText('Connection needed')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start privately' })).toBeDisabled()
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('invatrace-identity', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const request = db.transaction('identity', 'readonly').objectStore('identity').get('current')
        request.onsuccess = () => resolve(request.result ?? null)
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  })
  expect(stored).toBeNull()
})

test('private detector can scan, analyse, and submit', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'], { origin: 'http://localhost:5173' })
  await context.setGeolocation({ latitude: 3.1497, longitude: 101.6412, accuracy: 15 })
  const reportAuthorizationHeaders: string[] = []
  const accountEndpointCalls: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path === '/api/v1/reports') {
      reportAuthorizationHeaders.push(request.headers().authorization ?? '')
    }
    if (FORBIDDEN_ACCOUNT_ENDPOINTS.includes(path)) accountEndpointCalls.push(path)
  })

  const initialSession = await startPrivateAccess(page)

  await page.getByRole('button', { name: /Scan a plant|New scan/ }).first().click()
  await expect(page).toHaveURL(/\/scan$/)
  await expect(page.getByRole('heading', { name: 'Photograph a clear plant feature' })).toBeVisible()

  await page.locator('input[aria-label="Choose photo from gallery"]').setInputFiles(
    path.join(process.cwd(), 'public/reference-images/mikania_micrantha.jpg'),
  )

  await expect(page.getByText('Photo quality check passed')).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: /Analyse plant/ }).click()
  await expect(page).toHaveURL(/\/scan\/result$/, { timeout: 5000 })
  await expect(page.getByRole('heading', { name: 'Mikania micrantha' })).toBeVisible()

  await page.getByRole('button', { name: /Report sighting/ }).click()
  await expect(page).toHaveURL(/\/report$/)
  await expect(page.getByText(/Accurate to ~15 m/)).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('checkbox', { name: /accurate/i }).check()
  await page.getByRole('checkbox', { name: /personal information/i }).check()
  await page.getByRole('button', { name: 'Review submission' }).click()
  await expect(page.getByText('Mikania-Micrantha')).toBeVisible()
  await page.evaluate(() => {
    window.__msw = { expireSession: true }
  })
  const recoveryBootstrap = page.waitForResponse((response) => response.url().endsWith(BOOTSTRAP_PATH))
  await page.getByRole('button', { name: 'Submit report' }).click()
  const recoveredSession = await (await recoveryBootstrap).json() as { accessToken: string }

  await expect(page.getByRole('heading', { name: 'Report submitted' }))
    .toBeVisible({ timeout: 8000 })
  await page.getByRole('button', { name: 'View report' }).click()
  await expect(page.getByRole('heading', { name: 'Report published' }))
    .toBeVisible({ timeout: 7000 })
  expect(reportAuthorizationHeaders).toEqual([
    `Bearer ${initialSession.accessToken}`,
    `Bearer ${recoveredSession.accessToken}`,
  ])
  expect(accountEndpointCalls).toEqual([])
})

test('offline launch restores locally, then reconnects before flushing reports', async ({ page }) => {
  const { profile } = await startPrivateAccess(page)

  await page.evaluate(async (ownerProfileId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('invatrace', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('report-queue', 'readwrite')
      transaction.objectStore('report-queue').put({
        id: 'offline-e2e-report',
        ownerProfileId,
        createdAt: new Date().toISOString(),
        attempts: 1,
        retryable: true,
        lastError: 'Connection unavailable',
        submission: {
          photoKey: '',
          speciesId: 'mikania-micrantha',
          outcome: 'target',
          confidence: 0.91,
          modelVersion: 'development-model-v1',
          observedAt: new Date().toISOString(),
          captureId: crypto.randomUUID(),
          captureSource: 'camera',
          location: { lat: 3.1497, lng: 101.6412 },
          locationAccuracyM: 15,
          extent: 'small_patch',
          notes: '',
          consent: { accurate: true, noPII: true },
        },
        imageBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, profile.id)

  await page.addInitScript(() => {
    Object.defineProperty(window, '__invatraceOnline', {
      value: false,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(Navigator.prototype, 'onLine', {
      configurable: true,
      get() {
        return (window as unknown as { __invatraceOnline: boolean }).__invatraceOnline
      },
    })
  })

  const recoveryRequests: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path === BOOTSTRAP_PATH || path === '/api/v1/uploads/presign' || path === '/api/v1/reports') {
      recoveryRequests.push(path)
    }
  })

  await page.reload()
  await expect(page).toHaveURL(/\/map$/)
  await expect(page.getByText(/You're offline/)).toBeVisible()
  await expect(page.locator('input[type="email"], input[type="password"]')).toHaveCount(0)
  expect(recoveryRequests).not.toContain(BOOTSTRAP_PATH)
  expect(await queuedReportCount(page)).toBe(1)
  recoveryRequests.length = 0

  const bootstrapResponse = page.waitForResponse((response) => response.url().endsWith(BOOTSTRAP_PATH))
  const reportResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/reports')
  await page.evaluate(() => {
    ;(window as unknown as { __invatraceOnline: boolean }).__invatraceOnline = true
    window.dispatchEvent(new Event('online'))
  })
  await bootstrapResponse
  await reportResponse

  await expect.poll(() => queuedReportCount(page)).toBe(0)
  expect(recoveryRequests).toContain('/api/v1/uploads/presign')
  expect(recoveryRequests.indexOf(BOOTSTRAP_PATH))
    .toBeLessThan(recoveryRequests.indexOf('/api/v1/uploads/presign'))
})

test('threat map shows pins and ODbL attribution', async ({ page }) => {
  await startPrivateAccess(page)
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  await expect(page.locator('.map-attribution')).toContainText('OpenStreetMap')
  await expect(page.locator('.map-pin').first()).toBeVisible({ timeout: 5000 })
})
