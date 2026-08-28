import { create } from 'zustand'
import type {
  AnonymousIdentity,
  BootstrapSessionResponse,
  PseudonymousProfile,
  RecoveryCodeBatchResponse,
  RestorePrivateAccessResponse,
  StartPrivateAccessResponse,
} from '@/types'
import { api, ApiError, setAccessToken, setSessionRecovery } from './api'
import {
  clearAnonymousIdentity,
  createAnonymousIdentity,
  readAnonymousIdentity,
  rememberProfileId,
  saveAnonymousIdentity,
} from './anonymous-identity'

export type IdentityStatus =
  | 'initializing'
  | 'needs-access'
  | 'starting'
  | 'restoring'
  | 'recovery'
  | 'ready'
  | 'offline'
  | 'syncing'
  | 'error'
  | 'storage-error'
  | 'revoked'

interface IdentityState {
  status: IdentityStatus
  identity: AnonymousIdentity | null
  profile: PseudonymousProfile | null
  recoveryCodes: string[] | null
  recoveryBatchCreatedAt: string | null
  recoveryWasReissued: boolean
  syncMessage: string | null
  initialize: () => Promise<void>
  sync: () => Promise<boolean>
  startPrivate: () => Promise<void>
  restorePrivate: (profileId: string, recoveryCode: string) => Promise<void>
  acknowledgeRecovery: (displayName: string) => Promise<void>
  reissueRecoveryCodes: () => Promise<void>
  retryPendingStorage: () => Promise<boolean>
  updateDisplayName: (displayName: string | null) => Promise<void>
  clearRecoveryCodes: () => void
  markOffline: () => void
}

let initializePromise: Promise<void> | null = null
let syncPromise: Promise<boolean> | null = null
let pendingIdentity: AnonymousIdentity | null = null

function localProfile(identity: AnonymousIdentity): PseudonymousProfile {
  return {
    id: identity.profileId ?? 'local-installation',
    displayName: null,
    role: 'Detector',
    trustLevel: 'New',
  }
}

function normalizeDisplayName(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const hasControlCharacter = Array.from(trimmed).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  if (trimmed.length > 80 || hasControlCharacter) {
    throw new Error('Display name must be 80 characters or fewer and cannot contain control characters.')
  }
  return trimmed
}

async function safelyClearIdentity(): Promise<void> {
  try { await clearAnonymousIdentity() } catch { /* The next read will retry cleanup. */ }
}

export const useIdentity = create<IdentityState>((set, get) => ({
  status: 'initializing',
  identity: null,
  profile: null,
  recoveryCodes: null,
  recoveryBatchCreatedAt: null,
  recoveryWasReissued: false,
  syncMessage: null,

  initialize: async () => {
    if (initializePromise) return initializePromise
    set({ status: 'initializing', syncMessage: null })
    initializePromise = (async () => {
      try {
        const identity = await readAnonymousIdentity()
        if (!identity) {
          set({ status: 'needs-access', identity: null, profile: null, syncMessage: null })
          return
        }

        set({ identity, profile: identity.profileId ? localProfile(identity) : null })
        if (!navigator.onLine) {
          set({
            status: identity.profileId ? 'offline' : 'needs-access',
            syncMessage: identity.profileId
              ? null
              : 'A new or restored private profile needs a connection once before field use can begin.',
          })
          return
        }
        await get().sync()
      } catch {
        set({
          status: 'storage-error',
          identity: null,
          profile: null,
          syncMessage: 'InvaTrace cannot read this browser’s private installation storage. Allow site storage, then try again.',
        })
      }
    })()
    try {
      await initializePromise
    } finally {
      initializePromise = null
    }
  },

  sync: async () => {
    const currentIdentity = get().identity
    if (!currentIdentity) {
      set({ status: 'needs-access', profile: null })
      return false
    }
    if (syncPromise) return syncPromise
    syncPromise = (async () => {
      if (!navigator.onLine) {
        setAccessToken(null)
        set({
          status: currentIdentity.profileId ? 'offline' : 'needs-access',
          profile: currentIdentity.profileId ? localProfile(currentIdentity) : null,
          syncMessage: currentIdentity.profileId ? null : 'Connect once to establish private access.',
        })
        return false
      }

      set({ status: 'syncing', syncMessage: null })
      try {
        const response = await api<BootstrapSessionResponse>('/api/v1/profiles/bootstrap', {
          method: 'POST',
          body: JSON.stringify({ installationToken: currentIdentity.installationToken }),
        })
        setAccessToken(response.accessToken)

        let updatedIdentity: AnonymousIdentity = {
          ...currentIdentity,
          profileId: response.profile.id,
          recoverySetupComplete: !response.recoverySetupRequired,
        }
        try {
          updatedIdentity = await rememberProfileId(
            currentIdentity,
            response.profile.id,
            !response.recoverySetupRequired,
          )
        } catch {
          pendingIdentity = updatedIdentity
          set({
            status: 'storage-error',
            identity: updatedIdentity,
            profile: response.profile,
            syncMessage: 'The session was restored, but this browser could not update its private installation record.',
          })
          return false
        }

        set({ identity: updatedIdentity, profile: response.profile, syncMessage: null })
        if (response.recoverySetupRequired) {
          try {
            await get().reissueRecoveryCodes()
          } catch {
            set({
              status: 'recovery', recoveryCodes: null,
              syncMessage: 'The previous unseen codes are invalid, but a replacement batch could not be loaded. Try generating it again.',
            })
          }
          return false
        }
        set({ status: 'ready', recoveryCodes: null, recoveryBatchCreatedAt: null, recoveryWasReissued: false })
        return true
      } catch (error) {
        setAccessToken(null)
        if (error instanceof ApiError && error.code === 'installation_not_found') {
          await safelyClearIdentity()
          set({
            status: 'needs-access', identity: null, profile: null,
            syncMessage: 'This browser is not connected to a private profile yet.',
          })
          return false
        }
        if (error instanceof ApiError && (error.code === 'installation_revoked' || error.status === 401)) {
          await safelyClearIdentity()
          set({
            status: 'revoked', identity: null, profile: null,
            syncMessage: 'Access for this installation was revoked. Restore existing access to reconnect this device.',
          })
          return false
        }
        set({
          status: navigator.onLine ? 'error' : 'offline',
          profile: currentIdentity.profileId ? localProfile(currentIdentity) : null,
          syncMessage: navigator.onLine
            ? 'Sync is unavailable. Established installations can keep using offline-capable features.'
            : null,
        })
        return false
      }
    })()
    try {
      return await syncPromise
    } finally {
      syncPromise = null
    }
  },

  startPrivate: async () => {
    if (!navigator.onLine) throw new Error('Connect to the internet to start private access.')
    set({ status: 'starting', syncMessage: null })
    const newIdentity = createAnonymousIdentity()
    try {
      const response = await api<StartPrivateAccessResponse>('/api/v1/profiles/start', {
        method: 'POST',
        body: JSON.stringify({ installationToken: newIdentity.installationToken }),
      })
      setAccessToken(response.accessToken)
      const authorizedIdentity = { ...newIdentity, profileId: response.profile.id }
      try {
        await saveAnonymousIdentity(authorizedIdentity)
        pendingIdentity = null
      } catch {
        pendingIdentity = authorizedIdentity
      }
      set({
        status: 'recovery',
        identity: authorizedIdentity,
        profile: response.profile,
        recoveryCodes: response.recoveryCodes,
        recoveryBatchCreatedAt: new Date().toISOString(),
        recoveryWasReissued: false,
        syncMessage: pendingIdentity
          ? 'Your profile was created, but this browser could not save the installation. Allow site storage before continuing.'
          : null,
      })
    } catch (error) {
      set({ status: 'needs-access' })
      throw error
    }
  },

  restorePrivate: async (profileId, recoveryCode) => {
    if (!navigator.onLine) throw new Error('Connect to the internet to restore existing access.')
    set({ status: 'restoring', syncMessage: null })
    const newIdentity = createAnonymousIdentity()
    try {
      const response = await api<RestorePrivateAccessResponse>('/api/v1/profiles/restore', {
        method: 'POST',
        body: JSON.stringify({
          profileId: profileId.trim().toUpperCase(),
          recoveryCode: recoveryCode.trim().toUpperCase(),
          installationToken: newIdentity.installationToken,
        }),
      })
      setAccessToken(response.accessToken)
      const authorizedIdentity = {
        ...newIdentity,
        profileId: response.profile.id,
        recoverySetupComplete: true,
      }
      try {
        await saveAnonymousIdentity(authorizedIdentity)
        pendingIdentity = null
        set({
          status: 'ready', identity: authorizedIdentity, profile: response.profile,
          recoveryCodes: null, recoveryBatchCreatedAt: null, recoveryWasReissued: false, syncMessage: null,
        })
      } catch {
        pendingIdentity = authorizedIdentity
        set({
          status: 'storage-error', identity: authorizedIdentity, profile: response.profile,
          syncMessage: 'Access was restored, but this browser could not save the new installation. Allow site storage and try saving again.',
        })
      }
    } catch (error) {
      if (!pendingIdentity) set({ status: 'needs-access', profile: null })
      throw error
    }
  },

  acknowledgeRecovery: async (displayName) => {
    const identity = get().identity
    const profile = get().profile
    if (!identity || !profile || !get().recoveryCodes) throw new Error('Recovery setup is no longer available.')
    if (pendingIdentity && !await get().retryPendingStorage()) return

    const normalizedName = normalizeDisplayName(displayName)
    if (normalizedName !== profile.displayName) {
      const updated = await api<PseudonymousProfile>('/api/v1/profiles/me', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: normalizedName }),
      })
      set({ profile: updated })
    }
    await api<void>('/api/v1/profiles/me/recovery-setup/acknowledge', { method: 'POST' })

    const completedIdentity = { ...get().identity!, recoverySetupComplete: true }
    try {
      await saveAnonymousIdentity(completedIdentity)
      pendingIdentity = null
      set({
        status: 'ready', identity: completedIdentity,
        recoveryCodes: null, recoveryBatchCreatedAt: null, recoveryWasReissued: false, syncMessage: null,
      })
    } catch {
      pendingIdentity = completedIdentity
      set({
        status: 'recovery', identity: completedIdentity,
        syncMessage: 'Recovery was acknowledged, but this browser could not finish saving the installation. Allow site storage and try again.',
      })
    }
  },

  reissueRecoveryCodes: async () => {
    const batch = await api<RecoveryCodeBatchResponse>('/api/v1/profiles/me/recovery-codes/rotate', {
      method: 'POST',
    })
    set({
      status: 'recovery', recoveryCodes: batch.recoveryCodes,
      recoveryBatchCreatedAt: batch.createdAt, recoveryWasReissued: true, syncMessage: null,
    })
  },

  retryPendingStorage: async () => {
    if (!pendingIdentity) return true
    try {
      await saveAnonymousIdentity(pendingIdentity)
      const saved = pendingIdentity
      pendingIdentity = null
      const recoveryStillOpen = !!get().recoveryCodes && !saved.recoverySetupComplete
      set({
        identity: saved,
        status: recoveryStillOpen ? 'recovery' : 'ready',
        recoveryCodes: recoveryStillOpen ? get().recoveryCodes : null,
        recoveryBatchCreatedAt: recoveryStillOpen ? get().recoveryBatchCreatedAt : null,
        syncMessage: null,
      })
      return true
    } catch {
      set({ status: get().recoveryCodes ? 'recovery' : 'storage-error' })
      return false
    }
  },

  updateDisplayName: async (displayName) => {
    const updated = await api<PseudonymousProfile>('/api/v1/profiles/me', {
      method: 'PATCH',
      body: JSON.stringify({ displayName: displayName === null ? null : normalizeDisplayName(displayName) }),
    })
    set({ profile: updated })
  },

  clearRecoveryCodes: () => set({ recoveryCodes: null, recoveryBatchCreatedAt: null, recoveryWasReissued: false }),

  markOffline: () => {
    setAccessToken(null)
    const identity = get().identity
    if (identity?.profileId) {
      set({ status: 'offline', profile: get().profile ?? localProfile(identity), syncMessage: null })
    } else {
      set({ status: 'needs-access', profile: null, syncMessage: 'Connect once to establish private access.' })
    }
  },
}))

setSessionRecovery(() => useIdentity.getState().sync())

/** Keep the API session and report queue recovery in a strict reconnect order. */
export function installIdentityConnectivity(onSessionReady: () => Promise<unknown> | unknown) {
  const handleOnline = () => {
    void useIdentity.getState().sync()
      .then(async (ready) => {
        if (ready) await onSessionReady()
      })
      .catch(() => {})
  }
  const handleOffline = () => useIdentity.getState().markOffline()
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }
}
