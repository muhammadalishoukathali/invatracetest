import { create } from 'zustand'
import type {
  InstallationIdentity,
  BootstrapSessionResponse,
  PseudonymousProfile,
  RecoveryCodeBatchResponse,
  RestorePrivateAccessResponse,
  StartPrivateAccessResponse,
} from '@/types'
import { api, ApiError, setAccessToken, setSessionRecovery } from '@/services/api-client'
import {
  clearInstallationIdentity,
  createInstallationIdentity,
  readInstallationIdentity,
  rememberProfileId,
  saveInstallationIdentity,
} from './installation-storage'

// This store controls the full private-access lifecycle. It loads the browser's
// installation record, opens or restores the server session, keeps an offline
// fallback profile, and makes sure recovery codes are saved before access is ready.

type PrivateAccessStatus =
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

interface PrivateAccessState {
  status: PrivateAccessStatus
  installation: InstallationIdentity | null
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
let pendingInstallation: InstallationIdentity | null = null

function localProfile(installation: InstallationIdentity): PseudonymousProfile {
  return {
    id: installation.profileId ?? 'local-installation',
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

async function safelyClearInstallation(): Promise<void> {
  try {
    await clearInstallationIdentity()
  } catch {
    // A later startup will attempt the same cleanup again if IndexedDB was
    // temporarily unavailable.
  }
}

export const usePrivateAccess = create<PrivateAccessState>((set, get) => ({
  status: 'initializing',
  installation: null,
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
        const installation = await readInstallationIdentity()
        if (!installation) {
          set({ status: 'needs-access', installation: null, profile: null, syncMessage: null })
          return
        }

        set({ installation, profile: installation.profileId ? localProfile(installation) : null })
        if (!navigator.onLine) {
          set({
            status: installation.profileId ? 'offline' : 'needs-access',
            syncMessage: installation.profileId
              ? null
              : 'A new or restored private profile needs a connection once before field use can begin.',
          })
          return
        }
        await get().sync()
      } catch {
        set({
          status: 'storage-error',
          installation: null,
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
    const currentInstallation = get().installation
    if (!currentInstallation) {
      set({ status: 'needs-access', profile: null })
      return false
    }
    if (syncPromise) return syncPromise
    syncPromise = (async () => {
      if (!navigator.onLine) {
        setAccessToken(null)
        set({
          status: currentInstallation.profileId ? 'offline' : 'needs-access',
          profile: currentInstallation.profileId ? localProfile(currentInstallation) : null,
          syncMessage: currentInstallation.profileId ? null : 'Connect once to establish private access.',
        })
        return false
      }

      set({ status: 'syncing', syncMessage: null })
      try {
        const response = await api<BootstrapSessionResponse>('/api/v1/profiles/bootstrap', {
          method: 'POST',
          body: JSON.stringify({ installationToken: currentInstallation.installationToken }),
        })
        setAccessToken(response.accessToken)

        let updatedInstallation: InstallationIdentity = {
          ...currentInstallation,
          profileId: response.profile.id,
          recoverySetupComplete: !response.recoverySetupRequired,
        }
        try {
          updatedInstallation = await rememberProfileId(
            currentInstallation,
            response.profile.id,
            !response.recoverySetupRequired,
          )
        } catch {
          pendingInstallation = updatedInstallation
          set({
            status: 'storage-error',
            installation: updatedInstallation,
            profile: response.profile,
            syncMessage: 'The session was restored, but this browser could not update its private installation record.',
          })
          return false
        }

        set({ installation: updatedInstallation, profile: response.profile, syncMessage: null })
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
          await safelyClearInstallation()
          set({
            status: 'needs-access', installation: null, profile: null,
            syncMessage: 'This browser is not connected to a private profile yet.',
          })
          return false
        }
        if (error instanceof ApiError && (error.code === 'installation_revoked' || error.status === 401)) {
          await safelyClearInstallation()
          set({
            status: 'revoked', installation: null, profile: null,
            syncMessage: 'Access for this installation was revoked. Restore existing access to reconnect this device.',
          })
          return false
        }
        set({
          status: navigator.onLine ? 'error' : 'offline',
          profile: currentInstallation.profileId ? localProfile(currentInstallation) : null,
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
    const newInstallation = createInstallationIdentity()
    try {
      const response = await api<StartPrivateAccessResponse>('/api/v1/profiles/start', {
        method: 'POST',
        body: JSON.stringify({ installationToken: newInstallation.installationToken }),
      })
      setAccessToken(response.accessToken)
      const authorizedInstallation = { ...newInstallation, profileId: response.profile.id }
      try {
        await saveInstallationIdentity(authorizedInstallation)
        pendingInstallation = null
      } catch {
        pendingInstallation = authorizedInstallation
      }
      set({
        status: 'recovery',
        installation: authorizedInstallation,
        profile: response.profile,
        recoveryCodes: response.recoveryCodes,
        recoveryBatchCreatedAt: new Date().toISOString(),
        recoveryWasReissued: false,
        syncMessage: pendingInstallation
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
    const newInstallation = createInstallationIdentity()
    try {
      const response = await api<RestorePrivateAccessResponse>('/api/v1/profiles/restore', {
        method: 'POST',
        body: JSON.stringify({
          profileId: profileId.trim().toUpperCase(),
          recoveryCode: recoveryCode.trim().toUpperCase(),
          installationToken: newInstallation.installationToken,
        }),
      })
      setAccessToken(response.accessToken)
      const authorizedInstallation = {
        ...newInstallation,
        profileId: response.profile.id,
        recoverySetupComplete: true,
      }
      try {
        await saveInstallationIdentity(authorizedInstallation)
        pendingInstallation = null
        set({
          status: 'ready', installation: authorizedInstallation, profile: response.profile,
          recoveryCodes: null, recoveryBatchCreatedAt: null, recoveryWasReissued: false, syncMessage: null,
        })
      } catch {
        pendingInstallation = authorizedInstallation
        set({
          status: 'storage-error', installation: authorizedInstallation, profile: response.profile,
          syncMessage: 'Access was restored, but this browser could not save the new installation. Allow site storage and try saving again.',
        })
      }
    } catch (error) {
      if (!pendingInstallation) set({ status: 'needs-access', profile: null })
      throw error
    }
  },

  acknowledgeRecovery: async (displayName) => {
    const installation = get().installation
    const profile = get().profile
    if (!installation || !profile || !get().recoveryCodes) throw new Error('Recovery setup is no longer available.')
    if (pendingInstallation && !await get().retryPendingStorage()) return

    const normalizedName = normalizeDisplayName(displayName)
    if (normalizedName !== profile.displayName) {
      const updated = await api<PseudonymousProfile>('/api/v1/profiles/me', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: normalizedName }),
      })
      set({ profile: updated })
    }
    await api<void>('/api/v1/profiles/me/recovery-setup/acknowledge', { method: 'POST' })

    const completedInstallation = { ...get().installation!, recoverySetupComplete: true }
    try {
      await saveInstallationIdentity(completedInstallation)
      pendingInstallation = null
      set({
        status: 'ready', installation: completedInstallation,
        recoveryCodes: null, recoveryBatchCreatedAt: null, recoveryWasReissued: false, syncMessage: null,
      })
    } catch {
      pendingInstallation = completedInstallation
      set({
        status: 'recovery', installation: completedInstallation,
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
    if (!pendingInstallation) return true
    try {
      await saveInstallationIdentity(pendingInstallation)
      const saved = pendingInstallation
      pendingInstallation = null
      const recoveryStillOpen = !!get().recoveryCodes && !saved.recoverySetupComplete
      set({
        installation: saved,
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
    const installation = get().installation
    if (installation?.profileId) {
      set({ status: 'offline', profile: get().profile ?? localProfile(installation), syncMessage: null })
    } else {
      set({ status: 'needs-access', profile: null, syncMessage: 'Connect once to establish private access.' })
    }
  },
}))

setSessionRecovery(() => usePrivateAccess.getState().sync())

/** When the browser reconnects, restore the API session before uploading queued
 *  reports. Uploading first would send requests with an expired access token. */
export function installPrivateAccessConnectivity(onSessionReady: () => Promise<unknown> | unknown) {
  const handleOnline = () => {
    void usePrivateAccess.getState().sync()
      .then(async (ready) => {
        if (ready) await onSessionReady()
      })
      .catch(() => {})
  }
  const handleOffline = () => usePrivateAccess.getState().markOffline()
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }
}
