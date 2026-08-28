import type { AnonymousIdentity } from '@/types'

export const IDENTITY_DB_NAME = 'invatrace-identity'
export const IDENTITY_DB_VERSION = 1
export const IDENTITY_STORE_NAME = 'identity'
export const IDENTITY_RECORD_KEY = 'current'

const IDENTITY_SCHEMA_VERSION = 2 as const
const INSTALLATION_TOKEN_BYTES = 32

interface LegacyAnonymousIdentity {
  schemaVersion: 1
  installationToken: string
  createdAt: string
  profileId: string | null
}

function openIdentityDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDENTITY_DB_NAME, IDENTITY_DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDENTITY_STORE_NAME)) {
        db.createObjectStore(IDENTITY_STORE_NAME)
      }
    }
  })
}

/** Generate 256 bits of opaque randomness and encode it without URL-unsafe characters. */
export function generateInstallationToken(): string {
  const bytes = new Uint8Array(INSTALLATION_TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function hasValidCore(value: unknown): value is LegacyAnonymousIdentity | AnonymousIdentity {
  if (!value || typeof value !== 'object') return false
  const record = value as {
    schemaVersion?: unknown
    installationToken?: unknown
    createdAt?: unknown
    profileId?: unknown
  }
  return (record.schemaVersion === 1 || record.schemaVersion === IDENTITY_SCHEMA_VERSION)
    && typeof record.installationToken === 'string'
    && /^[A-Za-z0-9_-]{43}$/.test(record.installationToken)
    && typeof record.createdAt === 'string'
    && !Number.isNaN(Date.parse(record.createdAt))
    && (record.profileId === null || typeof record.profileId === 'string')
}

function canonicalIdentity(identity: LegacyAnonymousIdentity | AnonymousIdentity): AnonymousIdentity {
  return {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    installationToken: identity.installationToken,
    createdAt: identity.createdAt,
    profileId: identity.profileId,
    recoverySetupComplete: identity.schemaVersion === 2
      ? identity.recoverySetupComplete
      : identity.profileId !== null,
  }
}

function isCanonicalRecord(value: unknown): value is AnonymousIdentity {
  if (!hasValidCore(value) || value.schemaVersion !== IDENTITY_SCHEMA_VERSION) return false
  const record = value as AnonymousIdentity
  return typeof record.recoverySetupComplete === 'boolean'
    && Object.keys(record).length === 5
}

export function createAnonymousIdentity(): AnonymousIdentity {
  return {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    installationToken: generateInstallationToken(),
    createdAt: new Date().toISOString(),
    profileId: null,
    recoverySetupComplete: false,
  }
}

/**
 * Read or create the installation record in one read/write transaction. That
 * serialization prevents two newly opened tabs from racing to create tokens.
 */
export async function readAnonymousIdentity(): Promise<AnonymousIdentity | null> {
  const db = await openIdentityDb()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(IDENTITY_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(IDENTITY_STORE_NAME)
      const request = store.get(IDENTITY_RECORD_KEY)
      let identity: AnonymousIdentity | null = null

      request.onsuccess = () => {
        const stored = request.result
        identity = hasValidCore(stored) ? canonicalIdentity(stored) : null
        if (identity && !isCanonicalRecord(stored)) {
          store.put(identity, IDENTITY_RECORD_KEY)
        }
      }
      request.onerror = () => reject(request.error)
      transaction.oncomplete = () => {
        resolve(identity)
      }
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export async function saveAnonymousIdentity(identity: AnonymousIdentity): Promise<void> {
  const db = await openIdentityDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(IDENTITY_STORE_NAME, 'readwrite')
      transaction.objectStore(IDENTITY_STORE_NAME).put(identity, IDENTITY_RECORD_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export async function rememberProfileId(
  identity: AnonymousIdentity,
  profileId: string,
  recoverySetupComplete = identity.recoverySetupComplete,
): Promise<AnonymousIdentity> {
  const updated = { ...identity, profileId, recoverySetupComplete }
  await saveAnonymousIdentity(updated)
  return updated
}

export async function clearAnonymousIdentity(): Promise<void> {
  const db = await openIdentityDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(IDENTITY_STORE_NAME, 'readwrite')
      transaction.objectStore(IDENTITY_STORE_NAME).delete(IDENTITY_RECORD_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}
