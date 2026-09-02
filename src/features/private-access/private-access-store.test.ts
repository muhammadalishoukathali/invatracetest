import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InstallationIdentity } from '@/types'
import { api } from '@/services/api-client'
import { queryClient } from '@/services/query-client'
import { useReportDraft } from '@/features/report/report-draft-store'
import { useScan } from '@/features/scan/scan-store'
import { readInstallationIdentity } from './installation-storage'
import { usePrivateAccess } from './private-access-store'

afterEach(async () => {
  await usePrivateAccess.getState().signOut()
  queryClient.clear()
  useReportDraft.getState().reset()
  useScan.getState().reset()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('private access teardown', () => {
  it('clears profile-bound memory and cached responses on sign out', async () => {
    usePrivateAccess.setState({
      status: 'ready',
      profile: { id: 'profile-a', displayName: null, role: 'Detector', trustLevel: 'New' },
    })
    useScan.setState({
      location: {
        point: { lat: 3.1, lng: 101.6 },
        accuracyM: 10,
        capturedAt: '2026-09-01T10:00:00.000Z',
      },
    })
    useReportDraft.setState({
      draft: {
        photoKey: null,
        speciesId: 'mikania-micrantha',
        outcome: 'target',
        confidence: 0.9,
        modelVersion: 'test',
        observedAt: '2026-09-01T10:00:00.000Z',
        captureId: 'capture-a',
        captureSource: 'camera',
        location: { lat: 3.1, lng: 101.6 },
        locationAccuracyM: 10,
        extent: 'small_patch',
        notes: '',
        consentAccurate: true,
        consentNoPII: true,
      },
    })
    queryClient.setQueryData(['report', 'profile-a', 'report-a'], { private: true })

    await usePrivateAccess.getState().signOut()

    expect(usePrivateAccess.getState().status).toBe('needs-access')
    expect(useScan.getState().location).toBeNull()
    expect(useReportDraft.getState().draft).toBeNull()
    expect(queryClient.getQueryData(['report', 'profile-a', 'report-a'])).toBeUndefined()
  })

  it('ignores a revoked response from an installation replaced while bootstrap was pending', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    let resolveBootstrap!: (response: Response) => void
    const pendingBootstrap = new Promise<Response>((resolve) => { resolveBootstrap = resolve })
    let probeAuthorization: string | null = null
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const requestUrl = typeof input === 'string' ? input : input.toString()
      if (requestUrl.endsWith('/api/v1/profiles/bootstrap')) return pendingBootstrap
      if (requestUrl.endsWith('/api/v1/profiles/start')) {
        return Promise.resolve(Response.json({
          accessToken: 'replacement-access-token',
          profile: { id: 'profile-new', displayName: 'New profile', role: 'Detector', trustLevel: 'New' },
          recoveryCodes: ['RECOVERY-CODE'],
          installationId: 'installation-new',
        }))
      }
      if (requestUrl.endsWith('/api/v1/session-probe')) {
        probeAuthorization = new Headers(init?.headers).get('Authorization')
        return Promise.resolve(Response.json({ ok: true }))
      }
      throw new Error(`Unexpected request: ${requestUrl}`)
    }))

    const oldInstallation: InstallationIdentity = {
      schemaVersion: 2,
      installationToken: 'a'.repeat(43),
      createdAt: '2026-09-01T10:00:00.000Z',
      profileId: 'profile-old',
      recoverySetupComplete: true,
    }
    usePrivateAccess.setState({
      status: 'ready',
      installation: oldInstallation,
      profile: { id: 'profile-old', displayName: null, role: 'Detector', trustLevel: 'New' },
      recoveryCodes: null,
      recoveryBatchCreatedAt: null,
      recoveryWasReissued: false,
      syncMessage: null,
    })

    const staleSync = usePrivateAccess.getState().sync()
    await vi.waitFor(() => expect(usePrivateAccess.getState().status).toBe('syncing'))
    await usePrivateAccess.getState().startPrivate()
    const replacementInstallation = usePrivateAccess.getState().installation
    const replacementProfile = usePrivateAccess.getState().profile
    queryClient.setQueryData(['replacement-profile', 'private-data'], { retained: true })

    resolveBootstrap(Response.json(
      { code: 'installation_revoked', detail: 'The old installation was revoked.' },
      { status: 401 },
    ))
    await expect(staleSync).resolves.toBe(false)

    expect(usePrivateAccess.getState()).toMatchObject({
      status: 'recovery',
      installation: replacementInstallation,
      profile: replacementProfile,
    })
    expect(queryClient.getQueryData(['replacement-profile', 'private-data'])).toEqual({ retained: true })
    expect(await readInstallationIdentity()).toEqual(replacementInstallation)
    await api<{ ok: boolean }>('/api/v1/session-probe')
    expect(probeAuthorization).toBe('Bearer replacement-access-token')
  })
})
