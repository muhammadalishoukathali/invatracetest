import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import type { AccessOverview, AuthorizedInstallation, RecoveryCodeBatchResponse } from '@/types'
import { PrivateAccessButton, PrivateAccessField, PrivateAccessLink, RecoveryCodeGrid, PrivateAccessNotice } from '@/features/private-access/components/PrivateAccessControls'
import { Icon } from '@/components/Icon'
import { api } from '@/services/api-client'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { useOnline } from '@/hooks/useOnline'
import { copyText, downloadRecoveryKit, recoveryKitText } from '@/features/private-access/recovery-kit'
import { usePageHeadingFocus } from '@/hooks/usePageHeadingFocus'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { looksLikeContactDetail, safeDisplayName } from '@/features/private-access/display-name'

// Rough, non-precise date labels ("Yesterday", "3 days ago") on purpose —
// exact timestamps for when a device was added aren't something we want to
// dwell on in a UI about protecting your own devices.
function approximateDate(value: string): string {
  const date = new Date(value)
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(date)
}

function installationLabel(item: AuthorizedInstallation): string {
  return item.current ? 'This device' : `Device added ${approximateDate(item.createdAt)}`
}

/** The profile's control panel: edit display name, view/rotate recovery
 *  codes, and list/revoke authorized installations. Everything here reads
 *  and writes through /api/v1/profiles/me/* directly rather than through
 *  private-access-store.ts, except sign-out and display-name updates which
 *  the store already exposes. */
export function AccessManagementPage() {
  const headingRef = usePageHeadingFocus()
  const navigate = useNavigate()
  const online = useOnline()
  const profile = usePrivateAccess((state) => state.profile)!
  const updateDisplayName = usePrivateAccess((state) => state.updateDisplayName)
  const signOut = usePrivateAccess((state) => state.signOut)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [overview, setOverview] = useState<AccessOverview | null>(null)
  const [displayName, setDisplayName] = useState(profile.displayName ?? '')
  const [editingName, setEditingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const editNameButtonRef = useRef<HTMLButtonElement>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)
  const [replacement, setReplacement] = useState<RecoveryCodeBatchResponse | null>(null)

  const load = useCallback(async () => {
    // Nothing to fetch offline, and we don't want to show a stuck spinner —
    // fall through to the empty/loading=false state so the offline notice
    // below can take over instead.
    if (!online) { setLoading(false); return }
    setLoading(true)
    try {
      setOverview(await api<AccessOverview>('/api/v1/profiles/me/access'))
      setError(null)
    } catch {
      setError('Could not load access details. Try again once you have a stable connection.')
    } finally {
      setLoading(false)
    }
  }, [online])
  // Re-runs whenever `online` flips, so reconnecting after a network drop
  // automatically refetches instead of leaving stale/empty data on screen.
  useEffect(() => { void load() }, [load])

  const replacementInput = useMemo(() => replacement ? {
    profileId: overview?.profileId ?? profile.id,
    recoveryCodes: replacement.recoveryCodes,
    createdAt: new Date(replacement.createdAt),
  } : null, [overview?.profileId, profile.id, replacement])
  const profileId = overview?.profileId ?? profile.id
  const savedDisplayName = profile.displayName ?? ''
  const activeInstallations = (overview?.installations ?? []).filter((item) => !item.revokedAt)

  const openNameEditor = () => {
    setDisplayName(savedDisplayName)
    setNameError(null)
    setEditingName(true)
  }

  const closeNameEditor = () => {
    if (busy === 'name') return
    setDisplayName(savedDisplayName)
    setNameError(null)
    setEditingName(false)
  }

  const saveName = async () => {
    setBusy('name'); setNameError(null); setError(null); setMessage(null)
    const trimmed = displayName.trim()
    if (looksLikeContactDetail(trimmed)) {
      setBusy(null)
      setNameError('Use a nickname without an email address or phone number.')
      return
    }
    try {
      await updateDisplayName(trimmed)
      setDisplayName(usePrivateAccess.getState().profile?.displayName ?? '')
      setMessage(trimmed ? 'Display name updated.' : 'Display name removed.')
      setEditingName(false)
    } catch (nameError) {
      setNameError(nameError instanceof Error ? nameError.message : 'Display name could not be updated.')
    } finally { setBusy(null) }
  }

  // Rotating replaces the whole unused-code batch — this matches the server
  // rule that rotating invalidates every unused code from earlier batches
  // (docs/product.md), so we show the fresh batch here rather than silently
  // discarding it, the user needs to save these too.
  const rotate = async () => {
    setBusy('rotate'); setError(null); setMessage(null)
    try {
      const batch = await api<RecoveryCodeBatchResponse>('/api/v1/profiles/me/recovery-codes/rotate', { method: 'POST' })
      setReplacement(batch)
      setConfirmRotate(false)
      await load()
      setMessage('New codes generated. Older unused codes no longer work.')
    } catch {
      setError('Replacement codes could not be generated. Your current unused codes remain unchanged.')
    } finally { setBusy(null) }
  }

  // Revocation is per-installation, not per-profile — the profile and its
  // reports survive, only this one device loses its ability to act as an
  // authorized installation (it would need to restore again with a code).
  const revoke = async (installationId: string) => {
    setBusy(installationId); setError(null); setMessage(null)
    try {
      await api<void>(`/api/v1/profiles/me/installations/${encodeURIComponent(installationId)}/revoke`, { method: 'POST' })
      setConfirmRevoke(null)
      await load()
      setMessage('Device revoked. It can no longer restore this profile.')
    } catch {
      setError('That installation could not be revoked. Refresh the list and try again.')
    } finally { setBusy(null) }
  }

  const copy = async (text: string, success: string) => {
    try { await copyText(text); setMessage(success); setError(null) }
    catch { setError('Clipboard access is unavailable in this browser.') }
  }

  const handleSignOut = async () => {
    setBusy('sign-out')
    try {
      await signOut()
      navigate('/private-access', { replace: true })
    } finally {
      setBusy(null)
      setConfirmSignOut(false)
    }
  }

  return (
    <div className="access-management">
      <header className="access-profile-summary">
        <span className="access-profile-summary__avatar" aria-hidden>
          <Icon name="User" size={24} />
        </span>
        <div className="access-profile-summary__identity">
          <h2 ref={headingRef} tabIndex={-1}>{safeDisplayName(profile.displayName)}</h2>
          <button
            ref={editNameButtonRef}
            type="button"
            className="access-name-edit"
            aria-label="Edit display name"
            aria-haspopup="dialog"
            aria-expanded={editingName}
            onClick={openNameEditor}
          >
            <Icon name="Pencil" size={15} />
          </button>
        </div>
        <PrivateAccessLink href="/reports" icon="ClipboardList" replace>View my records</PrivateAccessLink>
      </header>

      {!online && <PrivateAccessNotice tone="warning" title="You are offline">Reconnect to change recovery codes, your display name, or devices.</PrivateAccessNotice>}
      {error && <PrivateAccessNotice tone="error" title="Something went wrong" live>{error}</PrivateAccessNotice>}
      {message && <PrivateAccessNotice tone="success" title="Saved" live>{message}</PrivateAccessNotice>}

      <section className="access-management__section" aria-labelledby="profile-access-heading">
        <div className="section-heading-row"><div><h3 id="profile-access-heading">Profile access</h3><p>Your ID is public. Sharing it alone cannot restore access.</p></div></div>
        <div className="profile-id-row">
          <div><span>Public profile ID</span><code>{profileId}</code></div>
          <PrivateAccessButton kind="quiet" icon="Copy" onClick={() => void copy(profileId, 'Public profile ID copied.')}>Copy ID</PrivateAccessButton>
        </div>
      </section>

      <section className="access-management__section" aria-labelledby="recovery-access-heading">
        <div className="section-heading-row"><div><h3 id="recovery-access-heading">Recovery codes</h3><p>One code restores this profile on a new device. Each code works once.</p></div></div>
        {replacement && replacementInput ? (
          <div className="replacement-batch">
            <PrivateAccessNotice tone="warning" title="Save these codes now">They stay in memory only until you leave this page.</PrivateAccessNotice>
            <RecoveryCodeGrid codes={replacement.recoveryCodes} />
            <div className="recovery-kit-actions">
              <PrivateAccessButton kind="secondary" icon="Copy" onClick={() => void copy(recoveryKitText(replacementInput), 'Recovery codes copied.')}>Copy recovery information</PrivateAccessButton>
              <PrivateAccessButton kind="secondary" icon="Download" onClick={() => downloadRecoveryKit(replacementInput)}>Download recovery kit</PrivateAccessButton>
              <PrivateAccessButton kind="quiet" onClick={() => setReplacement(null)}>I have saved these codes</PrivateAccessButton>
            </div>
          </div>
        ) : confirmRotate ? (
          <div className="destructive-confirmation">
            <Icon name="AlertTriangle" size={22} color="var(--amber-text)" />
            <div><strong>Replace all unused codes?</strong><p>Older unused codes stop working the moment new ones are issued.</p></div>
            <div><PrivateAccessButton kind="danger" onClick={() => void rotate()} disabled={busy === 'rotate'}>{busy === 'rotate' ? 'Replacing…' : 'Replace codes'}</PrivateAccessButton><PrivateAccessButton kind="quiet" onClick={() => setConfirmRotate(false)}>Cancel</PrivateAccessButton></div>
          </div>
        ) : (
          <div className="recovery-status-row">
            <span className="recovery-status-row__icon" aria-hidden><Icon name="KeyRound" size={20} /></span>
            <div>
              <strong>{loading ? 'Checking recovery codes…' : `${overview?.unusedRecoveryCodeCount ?? 0} unused code${overview?.unusedRecoveryCodeCount === 1 ? '' : 's'}`}</strong>
              <p>{loading ? 'One moment…' : 'Keep at least one code stored off this device.'}</p>
            </div>
            <PrivateAccessButton kind="secondary" icon="RefreshCw" onClick={() => setConfirmRotate(true)} disabled={!online || loading}>Replace codes</PrivateAccessButton>
          </div>
        )}
      </section>

      <section className="access-management__section" aria-labelledby="installations-heading">
        <div className="section-heading-row"><div><h3 id="installations-heading">Active devices</h3><p>Restoring adds a device without removing the old ones.</p></div></div>
        {loading ? <p className="access-muted" aria-live="polite">Loading devices…</p> : (
          <ul className="installation-list">
            {activeInstallations.length === 0 && <li className="installation-list__empty">No active devices.</li>}
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
        {confirmSignOut ? (
          <div className="destructive-confirmation access-sign-out-confirmation">
            <Icon name="AlertTriangle" size={22} color="var(--red-text)" />
            <div>
              <strong>Sign out of this browser?</strong>
              <p>This removes the local profile. You will need your profile ID and an unused recovery code to return.</p>
            </div>
            <div>
              <PrivateAccessButton kind="danger" onClick={() => void handleSignOut()} disabled={busy === 'sign-out'}>
                {busy === 'sign-out' ? 'Signing out…' : 'Yes, sign out'}
              </PrivateAccessButton>
              <PrivateAccessButton kind="quiet" onClick={() => setConfirmSignOut(false)}>Cancel</PrivateAccessButton>
            </div>
          </div>
        ) : (
          <div className="access-session-footer">
            <div>
              <strong>Finished on this device?</strong>
              <p>Sign out without deleting your reports or profile.</p>
            </div>
            <PrivateAccessButton className="access-sign-out-button" kind="quiet" icon="LogOut" onClick={() => setConfirmSignOut(true)}>
              Sign out
            </PrivateAccessButton>
          </div>
        )}
      </section>
      {editingName && (
        <EditDisplayNameDialog
          value={displayName}
          error={nameError}
          busy={busy === 'name'}
          online={online}
          returnFocus={() => editNameButtonRef.current}
          onChange={setDisplayName}
          onClose={closeNameEditor}
          onSave={() => void saveName()}
        />
      )}
    </div>
  )
}

/** Modal for changing the display name, opened from the pencil icon next to
 *  the profile heading. Split out mainly so useDialogA11y (focus trap +
 *  Escape/backdrop close) only has to manage this small subtree. */
function EditDisplayNameDialog({
  value, error, busy, online, returnFocus, onChange, onClose, onSave,
}: {
  value: string
  error: string | null
  busy: boolean
  online: boolean
  returnFocus: () => HTMLElement | null
  onChange: (value: string) => void
  onClose: () => void
  onSave: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  useDialogA11y(dialogRef, onClose, { returnFocus })

  return createPortal(
    <>
      <div className="access-modal-backdrop" aria-hidden onClick={onClose} />
      <section
        ref={dialogRef}
        className="access-name-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-display-name-title"
        tabIndex={-1}
      >
        <header className="access-name-dialog__header">
          <div>
            <h2 id="edit-display-name-title">Edit display name</h2>
            <p>This nickname appears with your submitted records.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy}>
            <Icon name="X" size={18} />
          </button>
        </header>
        <form onSubmit={(event) => { event.preventDefault(); onSave() }}>
          <PrivateAccessField
            id="access-display-name"
            label="Display name"
            hint="Use a nickname, not your real name, email, or phone number."
            error={error}
            value={value}
            maxLength={80}
            autoComplete="off"
            data-dialog-initial
            onChange={(event) => onChange(event.target.value)}
          />
          <div className="access-name-dialog__actions">
            <PrivateAccessButton type="button" kind="quiet" onClick={onClose} disabled={busy}>Cancel</PrivateAccessButton>
            <PrivateAccessButton type="submit" disabled={!online || busy}>
              {busy ? 'Saving…' : 'Save name'}
            </PrivateAccessButton>
          </div>
        </form>
      </section>
    </>,
    document.body,
  )
}
