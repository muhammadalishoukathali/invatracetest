import type { InstallationIdentity } from '@/types'

// This module owns the one browser record that connects this installation to a
// private profile. The stored database and object-store names cannot be changed,
// because existing users already have data saved under those names.
//
// Why IndexedDB and not localStorage: the installation token is a long-lived
// opaque credential (per docs/product.md, this is effectively how the app
// stays "signed in" with no email/password account behind it), and we wanted
// it in a store that isn't synchronous-blocking and isn't trivially readable
// by every third-party script the way localStorage sometimes gets treated.
// It still isn't a secure enclave — anyone with devtools access to this
// browser profile can read it — but that's an accepted tradeoff for a
// pseudonymous, installation-based identity model rather than a real secret.
export const INSTALLATION_DB_NAME = 'invatrace-identity'
const INSTALLATION_DB_VERSION = 1
const INSTALLATION_STORE_NAME = 'identity'
const INSTALLATION_RECORD_KEY = 'current'

const INSTALLATION_SCHEMA_VERSION = 2 as const
const INSTALLATION_TOKEN_BYTES = 32

interface LegacyInstallationIdentity {
  schemaVersion: 1
  installationToken: string
  createdAt: string
  profileId: string | null
}

function openInstallationDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(INSTALLATION_DB_NAME, INSTALLATION_DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(INSTALLATION_STORE_NAME)) {
        db.createObjectStore(INSTALLATION_STORE_NAME)
      }
    }
  })
}

/** Create a random 32-byte installation token and encode it with characters
 *  that are safe to send in a URL or JSON request. Uses crypto.getRandomValues
 *  rather than Math.random since this token is the thing standing in for a
 *  password — it needs to be unguessable, not just unique. */
function generateInstallationToken(): string {
  const bytes = new Uint8Array(INSTALLATION_TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function hasValidCore(value: unknown): value is LegacyInstallationIdentity | InstallationIdentity {
  if (!value || typeof value !== 'object') return false
  const record = value as {
    schemaVersion?: unknown
    installationToken?: unknown
    createdAt?: unknown
    profileId?: unknown
  }
  return (record.schemaVersion === 1 || record.schemaVersion === INSTALLATION_SCHEMA_VERSION)
    && typeof record.installationToken === 'string'
    && /^[A-Za-z0-9_-]{43}$/.test(record.installationToken)
    && typeof record.createdAt === 'string'
    && !Number.isNaN(Date.parse(record.createdAt))
    && (record.profileId === null || typeof record.profileId === 'string')
}

// v1 records didn't track whether recovery setup was ever acknowledged, so we
// backfill it from profileId: if a v1 install already had a profile attached,
// treat its recovery step as already done rather than forcing every existing
// user back through recovery setup on the next app load.
function normalizeInstallationRecord(record: LegacyInstallationIdentity | InstallationIdentity): InstallationIdentity {
  return {
    schemaVersion: INSTALLATION_SCHEMA_VERSION,
    installationToken: record.installationToken,
    createdAt: record.createdAt,
    profileId: record.profileId,
    recoverySetupComplete: record.schemaVersion === 2
      ? record.recoverySetupComplete
      : record.profileId !== null,
  }
}

function isCanonicalRecord(value: unknown): value is InstallationIdentity {
  if (!hasValidCore(value) || value.schemaVersion !== INSTALLATION_SCHEMA_VERSION) return false
  const record = value as InstallationIdentity
  return typeof record.recoverySetupComplete === 'boolean'
    && Object.keys(record).length === 5
}

export function createInstallationIdentity(): InstallationIdentity {
  return {
    schemaVersion: INSTALLATION_SCHEMA_VERSION,
    installationToken: generateInstallationToken(),
    createdAt: new Date().toISOString(),
    profileId: null,
    recoverySetupComplete: false,
  }
}

/** Read the current installation record and migrate older valid records to the
 *  latest shape in the same transaction. This function returns `null` when no
 *  authorized installation has been saved; it never creates one automatically. */
export async function readInstallationIdentity(): Promise<InstallationIdentity | null> {
  const db = await openInstallationDb()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(INSTALLATION_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(INSTALLATION_STORE_NAME)
      const request = store.get(INSTALLATION_RECORD_KEY)
      let installation: InstallationIdentity | null = null

      request.onsuccess = () => {
        const stored = request.result
        installation = hasValidCore(stored) ? normalizeInstallationRecord(stored) : null
        if (installation && !isCanonicalRecord(stored)) {
          store.put(installation, INSTALLATION_RECORD_KEY)
        }
      }
      request.onerror = () => reject(request.error)
      transaction.oncomplete = () => {
        resolve(installation)
      }
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export async function saveInstallationIdentity(installation: InstallationIdentity): Promise<void> {
  const db = await openInstallationDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(INSTALLATION_STORE_NAME, 'readwrite')
      transaction.objectStore(INSTALLATION_STORE_NAME).put(installation, INSTALLATION_RECORD_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export async function rememberProfileId(
  installation: InstallationIdentity,
  profileId: string,
  recoverySetupComplete = installation.recoverySetupComplete,
): Promise<InstallationIdentity> {
  const updated = { ...installation, profileId, recoverySetupComplete }
  await saveInstallationIdentity(updated)
  return updated
}

export async function clearInstallationIdentity(): Promise<void> {
  const db = await openInstallationDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(INSTALLATION_STORE_NAME, 'readwrite')
      transaction.objectStore(INSTALLATION_STORE_NAME).delete(INSTALLATION_RECORD_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

// Only clears the record if it still matches the token we started with. This
// guards against a race where the store already swapped in a newer
// installation (e.g. the user restored access in another tab) between when
// we decided to clear and when this actually runs — we don't want to nuke a
// record that isn't ours anymore.
export async function clearInstallationIdentityIfToken(expectedToken: string): Promise<void> {
  const db = await openInstallationDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(INSTALLATION_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(INSTALLATION_STORE_NAME)
      const request = store.get(INSTALLATION_RECORD_KEY)
      request.onsuccess = () => {
        if (hasValidCore(request.result) && request.result.installationToken === expectedToken) {
          store.delete(INSTALLATION_RECORD_KEY)
        }
      }
      request.onerror = () => reject(request.error)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}
