/** Iteration 2 Phase 6 - Epic 5.3 offline pack client tests.
 *
 *  Cache Storage doesn't exist in Node so a minimal in-memory polyfill
 *  stands in for the browser API; it only implements the subset the
 *  offline-pack service uses (open/delete/put/match/keys), which keeps
 *  the tests focused on the contract we actually rely on: SHA-256
 *  verify, fail-closed keep-last-valid, and stable manifest identity.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

import { handlers } from '@/mocks/handlers'
import {
  OfflinePackVerifyError,
  fetchOfflinePackManifest,
  installOfflinePack,
  readInstalledPack,
  readOfflineFile,
  removeOfflinePack,
} from './offline-pack'

class MemoryCache {
  entries = new Map<string, Response>()
  async put(request: Request | string, response: Response) {
    const key = typeof request === 'string' ? request : request.url
    this.entries.set(key, response)
  }
  async match(request: Request | string) {
    const key = typeof request === 'string' ? request : request.url
    const value = this.entries.get(key)
    return value ? value.clone() : undefined
  }
  async keys() {
    return Array.from(this.entries.keys()).map((k) => new Request(k))
  }
}

class MemoryCaches {
  buckets = new Map<string, MemoryCache>()
  async open(name: string) {
    let bucket = this.buckets.get(name)
    if (!bucket) {
      bucket = new MemoryCache()
      this.buckets.set(name, bucket)
    }
    return bucket
  }
  async delete(name: string) {
    return this.buckets.delete(name)
  }
}

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

beforeEach(() => {
  ;(globalThis as unknown as { caches: MemoryCaches }).caches = new MemoryCaches()
})

describe('offline pack client (AC 5.3.1 - 5.3.4)', () => {
  it('installs the pack after every file passes SHA-256 verification', async () => {
    const manifest = await fetchOfflinePackManifest()
    const pointer = await installOfflinePack(manifest)
    expect(pointer.catalogueVersion).toBe(manifest.catalogueVersion)
    expect(pointer.manifestSha256).toBe(manifest.manifestSha256)
    expect(pointer.fileCount).toBe(manifest.files.length)
  })

  it('surfaces the installed pointer through readInstalledPack after install', async () => {
    const manifest = await fetchOfflinePackManifest()
    await installOfflinePack(manifest)
    const pointer = await readInstalledPack()
    expect(pointer).not.toBeNull()
    expect(pointer!.catalogueVersion).toBe(manifest.catalogueVersion)
  })

  it('serves installed files without touching the network', async () => {
    const manifest = await fetchOfflinePackManifest()
    await installOfflinePack(manifest)
    // Kill the network for the read - only the cache should answer.
    server.use(
      http.get('*/api/v1/offline-pack/*', () =>
        HttpResponse.json({ code: 'offline' }, { status: 503 }),
      ),
    )
    const catalogue = await readOfflineFile<{ catalogue_version: string }>(
      'catalogue.json',
    )
    expect(catalogue?.catalogue_version).toBe(manifest.catalogueVersion)
  })

  it('keeps the last valid pack when a file digest does not match', async () => {
    const first = await fetchOfflinePackManifest()
    const original = await installOfflinePack(first)

    // Serve a payload whose bytes disagree with the manifest's declared
    // sha256, simulating a mid-flight rewrite or a corrupted CDN edge.
    server.use(
      http.get(`*/api/v1/offline-pack/${first.catalogueVersion}/catalogue.json`, () =>
        new HttpResponse('{"tampered":true}', {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    await expect(installOfflinePack(first)).rejects.toBeInstanceOf(
      OfflinePackVerifyError,
    )
    const pointer = await readInstalledPack()
    // AC 5.3.4 - a mismatch must NEVER partially overwrite the pack;
    // the previously installed pointer must survive intact.
    expect(pointer?.manifestSha256).toBe(original.manifestSha256)
  })

  it('remove clears the pointer so readInstalledPack returns null', async () => {
    const manifest = await fetchOfflinePackManifest()
    await installOfflinePack(manifest)
    await removeOfflinePack()
    const pointer = await readInstalledPack()
    expect(pointer).toBeNull()
  })

  it('rejects a fetch pointing at a different catalogue version', async () => {
    // The client only ever asks for downloadUrls that came out of the
    // manifest we fetched, but if a stale worker or a rewritten URL
    // sent us at another version, the server should refuse it. This
    // exercises the shape the mock returns so the pointer round-trip
    // stays honest.
    const res = await fetch('http://localhost/api/v1/offline-pack/v9999/catalogue.json')
    expect(res.status).toBe(404)
  })
})
