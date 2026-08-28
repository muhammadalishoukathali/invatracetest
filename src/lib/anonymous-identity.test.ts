import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createAnonymousIdentity,
  IDENTITY_DB_NAME,
  readAnonymousIdentity,
  rememberProfileId,
  saveAnonymousIdentity,
} from './anonymous-identity'

function deleteIdentityDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(IDENTITY_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Identity database deletion was blocked.'))
  })
}

describe('anonymous installation identity', () => {
  beforeEach(deleteIdentityDatabase)

  it('generates a versioned 256-bit base64url token without persisting it implicitly', async () => {
    const identity = createAnonymousIdentity()

    expect(identity.schemaVersion).toBe(2)
    expect(identity.installationToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await readAnonymousIdentity()).toBeNull()

    const base64 = identity.installationToken.replace(/-/g, '+').replace(/_/g, '/') + '='
    expect(atob(base64)).toHaveLength(32)
  })

  it('persists only installation identity metadata after server authorization', async () => {
    const identity = createAnonymousIdentity()
    await saveAnonymousIdentity(identity)
    await rememberProfileId(identity, 'IVT-TEST-PROFILE', true)
    const stored = await readAnonymousIdentity()

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
    const identity = createAnonymousIdentity()
    await saveAnonymousIdentity(identity)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(IDENTITY_DB_NAME, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('identity', 'readwrite')
      transaction.objectStore('identity').put({
        ...identity,
        role: 'Admin',
        trustLevel: 'Steward',
        accessToken: 'must-not-persist',
      }, 'current')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()

    const restored = await readAnonymousIdentity()

    expect(restored?.installationToken).toBe(identity.installationToken)
    expect(Object.keys(restored ?? {}).sort()).toEqual([
      'createdAt',
      'installationToken',
      'profileId',
      'recoverySetupComplete',
      'schemaVersion',
    ])
  })

  it('migrates an established version-1 installation as recovery-complete', async () => {
    const identity = createAnonymousIdentity()
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(IDENTITY_DB_NAME, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onupgradeneeded = () => request.result.createObjectStore('identity')
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('identity', 'readwrite')
      transaction.objectStore('identity').put({
        schemaVersion: 1,
        installationToken: identity.installationToken,
        createdAt: identity.createdAt,
        profileId: 'IVT-LEGACY-PROFILE',
      }, 'current')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()

    expect(await readAnonymousIdentity()).toMatchObject({
      schemaVersion: 2,
      profileId: 'IVT-LEGACY-PROFILE',
      recoverySetupComplete: true,
    })
  })
})
