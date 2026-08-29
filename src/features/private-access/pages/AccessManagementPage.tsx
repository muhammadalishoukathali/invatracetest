import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AccessOverview, AuthorizedInstallation, RecoveryCodeBatchResponse } from '@/types'
import { PrivateAccessButton, PrivateAccessField, RecoveryCodeGrid, PrivateAccessNotice } from '@/features/private-access/components/PrivateAccessControls'
import { Icon } from '@/components/Icon'
import { api } from '@/services/api-client'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { useOnline } from '@/hooks/useOnline'
import { copyText, downloadRecoveryKit, recoveryKitText } from '@/features/private-access/recovery-kit'
import { usePageHeadingFocus } from '@/hooks/usePageHeadingFocus'

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

export function AccessManagementPage() {
  const headingRef = usePageHeadingFocus()
  const online = useOnline()
  const profile = usePrivateAccess((state) => state.profile)!
  const updateDisplayName = usePrivateAccess((state) => state.updateDisplayName)
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
  const profileId = overview?.profileId ?? profile.id
  const savedDisplayName = profile.displayName ?? ''
  const activeInstallations = (overview?.installations ?? []).filter((item) => !item.revokedAt)

  const saveName = async () => {
    setBusy('name'); setError(null); setMessage(null)
    try {
      await updateDisplayName(displayName)
      setDisplayName(usePrivateAccess.getState().profile?.displayName ?? '')
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
      <header className="access-profile-summary">
        <span className="access-profile-summary__avatar" aria-hidden>
          <Icon name="User" size={24} />
        </span>
        <div className="access-profile-summary__identity">
          <h2 ref={headingRef} tabIndex={-1}>{profile.displayName ?? 'Local reporter'}</h2>
          <p>{profile.role} · {profile.trustLevel} trust</p>
        </div>
        <p className="access-profile-summary__description">
          This pseudonymous profile connects your field reports across authorized installations.
        </p>
      </header>

      {!online && <PrivateAccessNotice tone="warning" title="Access management is offline">Reconnect to update recovery codes, your display name, or installations.</PrivateAccessNotice>}
      {error && <PrivateAccessNotice tone="error" title="Access management needs attention" live>{error}</PrivateAccessNotice>}
      {message && <PrivateAccessNotice tone="success" title="Access updated" live>{message}</PrivateAccessNotice>}

      <section className="access-management__section" aria-labelledby="profile-access-heading">
        <div className="section-heading-row"><div><h3 id="profile-access-heading">Profile access</h3><p>Your ID is public. It cannot restore access without a recovery code.</p></div></div>
        <div className="profile-id-row">
          <div><span>Public profile ID</span><code>{profileId}</code></div>
          <PrivateAccessButton kind="quiet" icon="Copy" onClick={() => void copy(profileId, 'Public profile ID copied.')}>Copy ID</PrivateAccessButton>
        </div>
        <div className="access-name-editor">
          <PrivateAccessField id="access-display-name" label="Display name" hint="Optional. Shown with your reports and editable at any time." value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} />
          <PrivateAccessButton kind="secondary" onClick={() => void saveName()} disabled={!online || busy === 'name' || displayName === savedDisplayName}>{busy === 'name' ? 'Saving…' : 'Save name'}</PrivateAccessButton>
        </div>
      </section>

      <section className="access-management__section" aria-labelledby="recovery-access-heading">
        <div className="section-heading-row"><div><h3 id="recovery-access-heading">Recovery codes</h3><p>Each code restores this profile once on a new installation.</p></div></div>
        {replacement && replacementInput ? (
          <div className="replacement-batch">
            <PrivateAccessNotice tone="warning" title="Save this replacement batch now">These codes stay in memory only until you leave this page.</PrivateAccessNotice>
            <RecoveryCodeGrid codes={replacement.recoveryCodes} />
            <div className="recovery-kit-actions">
              <PrivateAccessButton kind="secondary" icon="Copy" onClick={() => void copy(recoveryKitText(replacementInput), 'Replacement recovery information copied.')}>Copy recovery information</PrivateAccessButton>
              <PrivateAccessButton kind="secondary" icon="Download" onClick={() => downloadRecoveryKit(replacementInput)}>Download recovery kit</PrivateAccessButton>
              <PrivateAccessButton kind="quiet" onClick={() => setReplacement(null)}>I have saved these codes</PrivateAccessButton>
            </div>
          </div>
        ) : confirmRotate ? (
          <div className="destructive-confirmation">
            <Icon name="AlertTriangle" size={22} color="var(--amber-text)" />
            <div><strong>Replace every unused recovery code?</strong><p>Older unused codes will stop working immediately.</p></div>
            <div><PrivateAccessButton kind="danger" onClick={() => void rotate()} disabled={busy === 'rotate'}>{busy === 'rotate' ? 'Replacing…' : 'Replace codes'}</PrivateAccessButton><PrivateAccessButton kind="quiet" onClick={() => setConfirmRotate(false)}>Cancel</PrivateAccessButton></div>
          </div>
        ) : (
          <div className="recovery-status-row">
            <span className="recovery-status-row__icon" aria-hidden><Icon name="KeyRound" size={20} /></span>
            <div>
              <strong>{loading ? 'Checking recovery codes…' : `${overview?.unusedRecoveryCodeCount ?? 0} unused code${overview?.unusedRecoveryCodeCount === 1 ? '' : 's'}`}</strong>
              <p>{loading ? 'This should only take a moment.' : 'Keep at least one code somewhere separate from this device.'}</p>
            </div>
            <PrivateAccessButton kind="secondary" icon="RefreshCw" onClick={() => setConfirmRotate(true)} disabled={!online || loading}>Replace codes</PrivateAccessButton>
          </div>
        )}
      </section>

      <section className="access-management__section" aria-labelledby="installations-heading">
        <div className="section-heading-row"><div><h3 id="installations-heading">Active installations</h3><p>Restoring adds a device. It does not revoke an earlier installation.</p></div></div>
        {loading ? <p className="access-muted" aria-live="polite">Loading installations…</p> : (
          <ul className="installation-list">
            {activeInstallations.length === 0 && <li className="installation-list__empty">No active installations were found.</li>}
            {activeInstallations.map((item) => (
              <li key={item.id}>
                <span className="installation-icon"><Icon name="Smartphone" size={19} /></span>
                <div><strong>{installationLabel(item)}</strong><p>Created {approximateDate(item.createdAt)} · Last used {approximateDate(item.lastUsedAt)}</p></div>
                {item.current ? <span className="current-installation">Current</span> : confirmRevoke === item.id ? (
                  <div className="installation-confirm"><span>Revoke?</span><PrivateAccessButton kind="danger" onClick={() => void revoke(item.id)} disabled={!online || busy === item.id}>Yes, revoke</PrivateAccessButton><PrivateAccessButton kind="quiet" onClick={() => setConfirmRevoke(null)}>Cancel</PrivateAccessButton></div>
                ) : <PrivateAccessButton kind="quiet" icon="Trash2" onClick={() => setConfirmRevoke(item.id)} disabled={!online}>Revoke</PrivateAccessButton>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="access-loss-warning">
        <Icon name="AlertTriangle" size={18} />
        <p>If every installation is lost or revoked and no unused recovery code remains, this profile cannot be recovered.</p>
      </div>
    </div>
  )
}
