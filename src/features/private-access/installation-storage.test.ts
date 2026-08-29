import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createInstallationIdentity,
  INSTALLATION_DB_NAME,
  readInstallationIdentity,
  rememberProfileId,
  saveInstallationIdentity,
} from './installation-storage'

function deleteInstallationDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(INSTALLATION_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Installation database deletion was blocked.'))
  })
}

describe('private-access installation storage', () => {
  beforeEach(deleteInstallationDatabase)

  it('generates a versioned 256-bit base64url token without persisting it implicitly', async () => {
    const installation = createInstallationIdentity()

    expect(installation.schemaVersion).toBe(2)
    expect(installation.installationToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await readInstallationIdentity()).toBeNull()

    const base64 = installation.installationToken.replace(/-/g, '+').replace(/_/g, '/') + '='
    expect(atob(base64)).toHaveLength(32)
  })

  it('persists only installation metadata after server authorization', async () => {
    const installation = createInstallationIdentity()
    await saveInstallationIdentity(installation)
    await rememberProfileId(installation, 'IVT-TEST-PROFILE', true)
    const stored = await readInstallationIdentity()

    expect(stored?.profileId).toBe('IVT-TEST-PROFILE')
    expect(Object.keys(stored ?? {}).sort()).toEqual([
      'createdAt',
      'installationToken',
      'profileId',
      'recoverySetupComplete',
      'schemaVersion',
    ])
  })

  it('discards injected privilege and API-session fields from the stored record', async () => {
    const installation = createInstallationIdentity()
    await saveInstallationIdentity(installation)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(INSTALLATION_DB_NAME, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('identity', 'readwrite')
      transaction.objectStore('identity').put({
        ...installation,
        role: 'Admin',
        trustLevel: 'Steward',
        accessToken: 'must-not-persist',
      }, 'current')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()

    const restored = await readInstallationIdentity()

    expect(restored?.installationToken).toBe(installation.installationToken)
    expect(Object.keys(restored ?? {}).sort()).toEqual([
      'createdAt',
      'installationToken',
      'profileId',
      'recoverySetupComplete',
      'schemaVersion',
    ])
  })

  it('migrates an established version-1 installation as recovery-complete', async () => {
    const installation = createInstallationIdentity()
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(INSTALLATION_DB_NAME, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onupgradeneeded = () => request.result.createObjectStore('identity')
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('identity', 'readwrite')
      transaction.objectStore('identity').put({
        schemaVersion: 1,
        installationToken: installation.installationToken,
        createdAt: installation.createdAt,
        profileId: 'IVT-LEGACY-PROFILE',
      }, 'current')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()

    expect(await readInstallationIdentity()).toMatchObject({
      schemaVersion: 2,
      profileId: 'IVT-LEGACY-PROFILE',
      recoverySetupComplete: true,
    })
  })
})
