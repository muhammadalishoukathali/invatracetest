/** Iteration 2 Phase 6 - Epic 5.3 offline catalogue pack client.
 *
 *  Talks to the two backend endpoints:
 *
 *    GET /api/v1/offline-pack/latest
 *    GET /api/v1/offline-pack/{catalogueVersion}/{path}
 *
 *  and installs the pack into a Cache Storage bucket named
 *  ``catalogue-<version>``. Every file is SHA-256 verified with the
 *  Web Crypto API BEFORE the previously installed pack is replaced,
 *  and a mismatch abandons the whole install to keep the last valid
 *  pack usable (AC 5.3.1, 5.3.4). The manifest itself is stored under
 *  a stable pointer key so the reader can find "the current pack"
 *  without probing every cache bucket.
 */
import { api, apiUrl } from './api-client'

export type OfflinePackFileEntry = {
  path: string
  sha256: string
  byteSize: number
  downloadUrl: string
}

export type OfflinePackManifest = {
  catalogueVersion: string
  reviewedAt: string
  totalSpeciesCount: number
  generatedAt: string
  manifestSha256: string
  totalByteSize: number
  files: OfflinePackFileEntry[]
}

export type InstalledPackPointer = {
  catalogueVersion: string
  manifestSha256: string
  cacheName: string
  installedAt: string
  byteSize: number
  fileCount: number
  reviewedAt: string
}

export type InstallProgress = {
  completed: number
  total: number
  currentPath?: string
}

// Stable pointer key used to persist "which cache bucket holds the
// currently installed pack". A separate cache bucket rather than
// localStorage so it lives alongside the pack bytes.
const POINTER_CACHE = 'catalogue-pointer'
const POINTER_URL = 'https://invatrace.local/offline-pack/pointer.json'
const MANIFEST_URL = 'https://invatrace.local/offline-pack/manifest.json'

function cacheStorageAvailable(): boolean {
  return typeof caches !== 'undefined' && typeof crypto?.subtle !== 'undefined'
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  const bytes = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0')
  }
  return hex
}

export async function fetchOfflinePackManifest(): Promise<OfflinePackManifest> {
  return api<OfflinePackManifest>('/api/v1/offline-pack/latest')
}

export async function readInstalledPack(): Promise<InstalledPackPointer | null> {
  if (!cacheStorageAvailable()) return null
  try {
    const cache = await caches.open(POINTER_CACHE)
    const res = await cache.match(POINTER_URL)
    if (!res) return null
    return (await res.json()) as InstalledPackPointer
  } catch {
    // A private-window Cache Storage that throws on open is treated
    // the same as "nothing installed" - the UI can offer to install
    // again, which is safe.
    return null
  }
}

export async function readInstalledManifest(): Promise<OfflinePackManifest | null> {
  const pointer = await readInstalledPack()
  if (!pointer) return null
  try {
    const cache = await caches.open(pointer.cacheName)
    const res = await cache.match(MANIFEST_URL)
    if (!res) return null
    return (await res.json()) as OfflinePackManifest
  } catch {
    return null
  }
}

export class OfflinePackVerifyError extends Error {
  path: string
  expected: string
  actual: string
  constructor(path: string, expected: string, actual: string) {
    super(`SHA-256 mismatch for ${path}`)
    this.name = 'OfflinePackVerifyError'
    this.path = path
    this.expected = expected
    this.actual = actual
  }
}

async function fetchAndVerify(
  entry: OfflinePackFileEntry,
): Promise<{ bytes: ArrayBuffer; response: Response }> {
  const res = await fetch(apiUrl(entry.downloadUrl), { credentials: 'omit' })
  if (!res.ok) {
    throw new Error(`offline_pack_fetch_failed:${entry.path}:${res.status}`)
  }
  const bytes = await res.clone().arrayBuffer()
  const actual = await sha256Hex(bytes)
  if (actual !== entry.sha256) {
    // AC 5.3.4 - a single hash mismatch aborts the install; the
    // caller keeps the previously installed pack around instead of
    // partially overwriting it.
    throw new OfflinePackVerifyError(entry.path, entry.sha256, actual)
  }
  return { bytes, response: res }
}

function fileUrlForPath(entry: OfflinePackFileEntry): string {
  // Cache keys are absolute URLs, so we anchor the pack files on a
  // synthetic origin. The reader uses the same anchor to look them up.
  return `https://invatrace.local/offline-pack${entry.downloadUrl}`
}

export async function installOfflinePack(
  manifest: OfflinePackManifest,
  onProgress?: (p: InstallProgress) => void,
): Promise<InstalledPackPointer> {
  if (!cacheStorageAvailable()) {
    throw new Error('offline_pack_unsupported')
  }

  const stagingCacheName = `catalogue-${manifest.catalogueVersion}-staging`
  const finalCacheName = `catalogue-${manifest.catalogueVersion}`

  // Wipe any half-built staging bucket from a prior aborted install
  // before we start; otherwise a mismatched file from last time could
  // survive and be mistaken for a fresh download later.
  await caches.delete(stagingCacheName)
  const staging = await caches.open(stagingCacheName)

  onProgress?.({ completed: 0, total: manifest.files.length })
  for (let i = 0; i < manifest.files.length; i++) {
    const entry = manifest.files[i]!
    try {
      const { bytes } = await fetchAndVerify(entry)
      await staging.put(
        fileUrlForPath(entry),
        new Response(bytes, {
          headers: {
            'Content-Type': 'application/json',
            'X-InvaTrace-File-SHA256': entry.sha256,
          },
        }),
      )
    } catch (err) {
      // Fail closed: throw away the staging bucket so we do not leave
      // partially-verified bytes around; the previously installed
      // final bucket is untouched, so the user keeps their working
      // pack (AC 5.3.4).
      await caches.delete(stagingCacheName)
      throw err
    }
    onProgress?.({
      completed: i + 1,
      total: manifest.files.length,
      currentPath: entry.path,
    })
  }

  // Persist the manifest itself alongside the files so the reader can
  // resolve species without a network round-trip.
  await staging.put(
    MANIFEST_URL,
    new Response(JSON.stringify(manifest), {
      headers: { 'Content-Type': 'application/json' },
    }),
  )

  // Atomic-ish swap: the previous final bucket is deleted only after
  // every file has verified and been written to staging. If the
  // process is killed between these two lines the pointer still
  // targets the old bucket, so the last valid pack is preserved.
  const previous = await readInstalledPack()
  await caches.delete(finalCacheName)
  const finalCache = await caches.open(finalCacheName)
  for (const req of await staging.keys()) {
    const res = await staging.match(req)
    if (res) await finalCache.put(req, res)
  }
  await caches.delete(stagingCacheName)
  if (previous && previous.cacheName !== finalCacheName) {
    await caches.delete(previous.cacheName)
  }

  const pointer: InstalledPackPointer = {
    catalogueVersion: manifest.catalogueVersion,
    manifestSha256: manifest.manifestSha256,
    cacheName: finalCacheName,
    installedAt: new Date().toISOString(),
    byteSize: manifest.totalByteSize,
    fileCount: manifest.files.length,
    reviewedAt: manifest.reviewedAt,
  }
  const pointerCache = await caches.open(POINTER_CACHE)
  await pointerCache.put(
    POINTER_URL,
    new Response(JSON.stringify(pointer), {
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  return pointer
}

export async function removeOfflinePack(): Promise<void> {
  if (!cacheStorageAvailable()) return
  const pointer = await readInstalledPack()
  if (pointer) {
    await caches.delete(pointer.cacheName)
  }
  await caches.delete(POINTER_CACHE)
}

/** Read a single file (path relative to the pack root, e.g.
 *  ``catalogue.json`` or ``species/mikania-micrantha.json``) from the
 *  installed pack. Returns null when nothing is installed OR when the
 *  file is missing; the caller decides whether to fall back to the
 *  online endpoint. Never re-verifies here - verification happened
 *  during install; re-verifying on every read would defeat the
 *  cache's purpose for large offline sessions. */
export async function readOfflineFile<T>(relativePath: string): Promise<T | null> {
  const pointer = await readInstalledPack()
  if (!pointer) return null
  try {
    const cache = await caches.open(pointer.cacheName)
    const url = `https://invatrace.local/offline-pack/api/v1/offline-pack/${pointer.catalogueVersion}/${relativePath}`
    const res = await cache.match(url)
    if (!res) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}
