/** Iteration 2 Phase 6 - Epic 5.3 offline catalogue pack settings page.
 *
 *  Lets the user install, refresh or remove the offline evidence
 *  catalogue pack. Every state transition is driven by the pack
 *  service (``src/services/offline-pack.ts``) which owns the
 *  SHA-256-verify + keep-last-valid semantics; this page is a thin
 *  presentation layer over it (AC 5.3.1, 5.3.2, 5.3.4).
 */
import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useOnline } from '@/hooks/useOnline'
import {
  OfflinePackVerifyError,
  fetchOfflinePackManifest,
  installOfflinePack,
  readInstalledPack,
  removeOfflinePack,
  type InstallProgress,
  type InstalledPackPointer,
} from '@/services/offline-pack'

type FailedInstall = { message: string; verifyPath?: string }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function OfflineSettingsPage() {
  const online = useOnline()
  const [installed, setInstalled] = useState<InstalledPackPointer | null>(null)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [failure, setFailure] = useState<FailedInstall | null>(null)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    void readInstalledPack().then(setInstalled)
  }, [])

  const manifestQuery = useQuery({
    queryKey: ['offline-pack', 'manifest'],
    queryFn: fetchOfflinePackManifest,
    enabled: online,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  })

  const upgradeAvailable =
    manifestQuery.data && installed
      ? manifestQuery.data.manifestSha256 !== installed.manifestSha256
      : Boolean(manifestQuery.data && !installed)

  const handleInstall = useCallback(async () => {
    if (!manifestQuery.data) return
    setInstalling(true)
    setFailure(null)
    setProgress({ completed: 0, total: manifestQuery.data.files.length })
    try {
      const pointer = await installOfflinePack(manifestQuery.data, setProgress)
      setInstalled(pointer)
    } catch (err) {
      if (err instanceof OfflinePackVerifyError) {
        setFailure({
          message:
            'A downloaded file did not match its expected checksum. Your last working offline pack is still installed.',
          verifyPath: err.path,
        })
      } else {
        setFailure({
          message:
            'Could not finish installing the offline pack. Your last working offline pack is still installed.',
        })
      }
    } finally {
      setInstalling(false)
      setProgress(null)
    }
  }, [manifestQuery.data])

  const handleRemove = useCallback(async () => {
    setRemoving(true)
    try {
      await removeOfflinePack()
      setInstalled(null)
    } finally {
      setRemoving(false)
    }
  }, [])

  return (
    <section style={{ padding: 20, maxWidth: 640 }}>
      <header>
        <h1 style={{ marginTop: 0 }}>Offline catalogue</h1>
        <p style={{ color: 'var(--muted)', marginTop: 4 }}>
          Install the evidence catalogue on this device so the bestiary
          works without a connection. Every file is verified against
          its checksum before it replaces the pack you already have -
          if a check fails, your previous pack is kept intact.
        </p>
      </header>

      <div
        style={{
          marginTop: 16,
          padding: 14,
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-card)',
          background: 'var(--surface)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14 }}>Installed pack</h2>
        {installed ? (
          <dl style={{ margin: '10px 0 0', fontSize: 13 }}>
            <div>
              <dt style={{ display: 'inline', color: 'var(--muted)' }}>Version </dt>
              <dd style={{ display: 'inline', margin: 0 }}>
                {installed.catalogueVersion}
              </dd>
            </div>
            <div>
              <dt style={{ display: 'inline', color: 'var(--muted)' }}>Reviewed </dt>
              <dd style={{ display: 'inline', margin: 0 }}>
                {new Date(installed.reviewedAt).toLocaleDateString()}
              </dd>
            </div>
            <div>
              <dt style={{ display: 'inline', color: 'var(--muted)' }}>Size </dt>
              <dd style={{ display: 'inline', margin: 0 }}>
                {formatBytes(installed.byteSize)} · {installed.fileCount} files
              </dd>
            </div>
            <div>
              <dt style={{ display: 'inline', color: 'var(--muted)' }}>Installed </dt>
              <dd style={{ display: 'inline', margin: 0 }}>
                {new Date(installed.installedAt).toLocaleString()}
              </dd>
            </div>
          </dl>
        ) : (
          <p style={{ marginTop: 8, fontSize: 13 }}>
            No offline pack installed on this device yet.
          </p>
        )}
      </div>

      <div
        style={{
          marginTop: 12,
          padding: 14,
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-card)',
          background: 'var(--surface)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14 }}>Latest available</h2>
        {!online ? (
          <p style={{ marginTop: 8, fontSize: 13 }}>
            You are offline. Reconnect to check for a newer pack.
          </p>
        ) : manifestQuery.isPending ? (
          <p style={{ marginTop: 8, fontSize: 13 }}>Checking the server...</p>
        ) : manifestQuery.isError || !manifestQuery.data ? (
          <p style={{ marginTop: 8, fontSize: 13 }}>
            Could not reach the catalogue server. Try again shortly.
          </p>
        ) : (
          <dl style={{ margin: '10px 0 0', fontSize: 13 }}>
            <div>
              <dt style={{ display: 'inline', color: 'var(--muted)' }}>Version </dt>
              <dd style={{ display: 'inline', margin: 0 }}>
                {manifestQuery.data.catalogueVersion}
                {upgradeAvailable && (
                  <> · <span style={{ color: 'var(--accent)' }}>update available</span></>
                )}
              </dd>
            </div>
            <div>
              <dt style={{ display: 'inline', color: 'var(--muted)' }}>Size </dt>
              <dd style={{ display: 'inline', margin: 0 }}>
                {formatBytes(manifestQuery.data.totalByteSize)} ·{' '}
                {manifestQuery.data.files.length} files
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div
        aria-live="polite"
        role="status"
        style={{ minHeight: 24, marginTop: 12, fontSize: 13 }}
      >
        {installing && progress
          ? `Verifying ${progress.completed} of ${progress.total} files...`
          : failure
          ? failure.message +
            (failure.verifyPath ? ` (${failure.verifyPath})` : '')
          : null}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleInstall}
          disabled={
            !online || installing || removing || !manifestQuery.data
          }
        >
          {installed ? 'Re-download' : 'Install offline pack'}
        </button>
        {installed && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={installing || removing}
          >
            Remove pack
          </button>
        )}
      </div>
    </section>
  )
}
