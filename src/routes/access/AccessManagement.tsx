import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AccessOverview, AuthorizedInstallation, RecoveryCodeBatchResponse } from '@/types'
import { AccessButton, AccessField, RecoveryCodeGrid, StatusNotice } from '@/components/access/AccessUi'
import { Icon } from '@/components/Icon'
import { api } from '@/lib/api'
import { useIdentity } from '@/lib/identity'
import { useOnline } from '@/lib/useOnline'
import { copyText, downloadRecoveryKit, recoveryKitText } from '@/lib/recovery-kit'
import { usePageHeadingFocus } from '@/lib/usePageHeadingFocus'

function approximateDate(value: string): string {
  const date = new Date(value)
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(date)
}

function installationLabel(item: AuthorizedInstallation): string {
  return item.current ? 'This installation' : `Installation added ${approximateDate(item.createdAt)}`
}

export function AccessManagement() {
  const headingRef = usePageHeadingFocus()
  const online = useOnline()
  const profile = useIdentity((state) => state.profile)!
  const updateDisplayName = useIdentity((state) => state.updateDisplayName)
  const [overview, setOverview] = useState<AccessOverview | null>(null)
  const [displayName, setDisplayName] = useState(profile.displayName ?? '')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)
  const [replacement, setReplacement] = useState<RecoveryCodeBatchResponse | null>(null)

  const load = useCallback(async () => {
    if (!online) { setLoading(false); return }
    setLoading(true)
    try {
      setOverview(await api<AccessOverview>('/api/v1/profiles/me/access'))
      setError(null)
    } catch {
      setError('Access details could not be loaded. Try again when the connection is stable.')
    } finally {
      setLoading(false)
    }
  }, [online])
  useEffect(() => { void load() }, [load])

  const replacementInput = useMemo(() => replacement ? {
    profileId: overview?.profileId ?? profile.id,
    recoveryCodes: replacement.recoveryCodes,
    createdAt: new Date(replacement.createdAt),
  } : null, [overview?.profileId, profile.id, replacement])

  const saveName = async () => {
    setBusy('name'); setError(null); setMessage(null)
    try {
      await updateDisplayName(displayName)
      setDisplayName(useIdentity.getState().profile?.displayName ?? '')
      setMessage(displayName.trim() ? 'Display name updated.' : 'Display name removed.')
    } catch (nameError) {
      setError(nameError instanceof Error ? nameError.message : 'Display name could not be updated.')
    } finally { setBusy(null) }
  }

  const rotate = async () => {
    setBusy('rotate'); setError(null); setMessage(null)
    try {
      const batch = await api<RecoveryCodeBatchResponse>('/api/v1/profiles/me/recovery-codes/rotate', { method: 'POST' })
      setReplacement(batch)
      setConfirmRotate(false)
      await load()
      setMessage('Replacement codes generated. Every unused older code is now invalid.')
    } catch {
      setError('Replacement codes could not be generated. Your current unused codes remain unchanged.')
    } finally { setBusy(null) }
  }

  const revoke = async (installationId: string) => {
    setBusy(installationId); setError(null); setMessage(null)
    try {
      await api<void>(`/api/v1/profiles/me/installations/${encodeURIComponent(installationId)}/revoke`, { method: 'POST' })
      setConfirmRevoke(null)
      await load()
      setMessage('Installation revoked. It can no longer bootstrap this profile.')
    } catch {
      setError('That installation could not be revoked. Refresh the list and try again.')
    } finally { setBusy(null) }
  }

  const copy = async (text: string, success: string) => {
    try { await copyText(text); setMessage(success); setError(null) }
    catch { setError('Clipboard access is unavailable in this browser.') }
  }

  return (
    <div className="access-management">
      <div className="access-management__intro">
        <h2 ref={headingRef} tabIndex={-1}>Recovery and installations</h2>
        <p>Manage the pseudonymous profile, recovery options, and installations that can submit as you.</p>
      </div>

      {!online && <StatusNotice tone="warning" title="Access management is offline">Reconnect to update recovery codes, your display name, or installations.</StatusNotice>}
      {error && <StatusNotice tone="error" title="Access management needs attention" live>{error}</StatusNotice>}
      {message && <StatusNotice tone="success" title="Access updated" live>{message}</StatusNotice>}

      <section className="access-management__section" aria-labelledby="profile-access-heading">
        <div className="section-heading-row"><div><h3 id="profile-access-heading">Profile access</h3><p>Your ID is public. It cannot restore access without a recovery code.</p></div></div>
        <div className="profile-id-row"><code>{overview?.profileId ?? profile.id}</code><AccessButton kind="quiet" icon="Copy" onClick={() => void copy(overview?.profileId ?? profile.id, 'Public profile ID copied.')}>Copy ID</AccessButton></div>
        <div className="access-name-editor">
          <AccessField id="access-display-name" label="Display name (optional)" hint="Shown with your pseudonymous profile and editable at any time." value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} />
          <AccessButton kind="secondary" onClick={() => void saveName()} disabled={!online || busy === 'name'}>{busy === 'name' ? 'Saving…' : 'Save display name'}</AccessButton>
        </div>
      </section>

      <section className="access-management__section" aria-labelledby="recovery-access-heading">
        <div className="section-heading-row"><div><h3 id="recovery-access-heading">Recovery codes</h3><p>Unused codes remaining: <strong>{loading ? '—' : overview?.unusedRecoveryCodeCount ?? '—'}</strong></p></div></div>
        {replacement && replacementInput ? (
          <div className="replacement-batch">
            <StatusNotice tone="warning" title="Save this replacement batch now">These codes stay in memory only until you leave this page.</StatusNotice>
            <RecoveryCodeGrid codes={replacement.recoveryCodes} />
            <div className="recovery-kit-actions">
              <AccessButton kind="secondary" icon="Copy" onClick={() => void copy(recoveryKitText(replacementInput), 'Replacement recovery information copied.')}>Copy recovery information</AccessButton>
              <AccessButton kind="secondary" icon="Download" onClick={() => downloadRecoveryKit(replacementInput)}>Download recovery kit</AccessButton>
              <AccessButton kind="quiet" onClick={() => setReplacement(null)}>I have saved these codes</AccessButton>
            </div>
          </div>
        ) : confirmRotate ? (
          <div className="destructive-confirmation">
            <Icon name="AlertTriangle" size={22} color="var(--amber-text)" />
            <div><strong>Replace every unused recovery code?</strong><p>Older unused codes will stop working immediately.</p></div>
            <div><AccessButton kind="danger" onClick={() => void rotate()} disabled={busy === 'rotate'}>{busy === 'rotate' ? 'Replacing…' : 'Replace codes'}</AccessButton><AccessButton kind="quiet" onClick={() => setConfirmRotate(false)}>Cancel</AccessButton></div>
          </div>
        ) : (
          <AccessButton kind="secondary" icon="RefreshCw" onClick={() => setConfirmRotate(true)} disabled={!online}>Generate replacement batch</AccessButton>
        )}
      </section>

      <section className="access-management__section" aria-labelledby="installations-heading">
        <div className="section-heading-row"><div><h3 id="installations-heading">Active installations</h3><p>Restoring adds a device. It does not revoke an earlier installation.</p></div></div>
        {loading ? <p className="access-muted" aria-live="polite">Loading installations…</p> : (
          <ul className="installation-list">
            {(overview?.installations ?? []).filter((item) => !item.revokedAt).map((item) => (
              <li key={item.id}>
                <span className="installation-icon"><Icon name="Smartphone" size={19} /></span>
                <div><strong>{installationLabel(item)}</strong><p>Created {approximateDate(item.createdAt)} · Last used {approximateDate(item.lastUsedAt)}</p></div>
                {item.current ? <span className="current-installation">Current</span> : confirmRevoke === item.id ? (
                  <div className="installation-confirm"><span>Revoke?</span><AccessButton kind="danger" onClick={() => void revoke(item.id)} disabled={busy === item.id}>Yes, revoke</AccessButton><AccessButton kind="quiet" onClick={() => setConfirmRevoke(null)}>Cancel</AccessButton></div>
                ) : <AccessButton kind="quiet" icon="Trash2" onClick={() => setConfirmRevoke(item.id)}>Revoke</AccessButton>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="access-loss-warning">If every installation is lost or revoked and no unused recovery code remains, this profile cannot be recovered.</p>
    </div>
  )
}
