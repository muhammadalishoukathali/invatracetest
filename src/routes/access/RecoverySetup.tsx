import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AccessLayout } from '@/components/access/AccessLayout'
import { AccessButton, AccessField, RecoveryCodeGrid, StatusNotice } from '@/components/access/AccessUi'
import { copyText, downloadRecoveryKit, recoveryKitText } from '@/lib/recovery-kit'
import { useIdentity } from '@/lib/identity'
import { usePageHeadingFocus } from '@/lib/usePageHeadingFocus'

export function RecoverySetup() {
  const navigate = useNavigate()
  const headingRef = usePageHeadingFocus()
  const profile = useIdentity((state) => state.profile)
  const identity = useIdentity((state) => state.identity)
  const status = useIdentity((state) => state.status)
  const codes = useIdentity((state) => state.recoveryCodes)
  const batchCreatedAt = useIdentity((state) => state.recoveryBatchCreatedAt)
  const recoveryWasReissued = useIdentity((state) => state.recoveryWasReissued)
  const syncMessage = useIdentity((state) => state.syncMessage)
  const acknowledgeRecovery = useIdentity((state) => state.acknowledgeRecovery)
  const reissueRecoveryCodes = useIdentity((state) => state.reissueRecoveryCodes)
  const retryPendingStorage = useIdentity((state) => state.retryPendingStorage)
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '')
  const [acknowledged, setAcknowledged] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [continuing, setContinuing] = useState(false)

  if (status === 'ready') return <Navigate to="/map" replace />
  if (!profile || !identity) return <Navigate to="/private-access" replace />

  const createdAt = new Date(batchCreatedAt ?? Date.now())
  const kitInput = { profileId: profile.id, recoveryCodes: codes ?? [], createdAt }

  const copy = async (kind: 'id' | 'kit') => {
    setError(null)
    try {
      await copyText(kind === 'id' ? profile.id : recoveryKitText(kitInput))
      setMessage(kind === 'id' ? 'Public profile ID copied.' : 'Recovery information copied. Keep it private.')
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Copying is unavailable.')
    }
  }

  const continueToApp = async () => {
    if (!acknowledged) {
      setError('Confirm that you saved the recovery information before continuing.')
      return
    }
    setContinuing(true)
    setError(null)
    try {
      await acknowledgeRecovery(displayName)
      if (useIdentity.getState().status === 'ready') navigate('/map', { replace: true })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Recovery setup could not be completed.')
    } finally {
      setContinuing(false)
    }
  }

  return (
    <AccessLayout>
      <section className="recovery-setup">
        <div className="recovery-setup__heading">
          <div>
            <h1 ref={headingRef} tabIndex={-1}>Save your recovery information</h1>
            <p>This is the only time InvaTrace will show this recovery-code batch.</p>
          </div>
          <span className="secret-badge">Secret</span>
        </div>

        {syncMessage && (
          <StatusNotice tone="warning" title="Recovery setup needs attention" live>{syncMessage}</StatusNotice>
        )}
        {recoveryWasReissued && codes && (
          <StatusNotice tone="info" title="A replacement batch was issued" live>
            Setup was interrupted, so every previously shown code was invalidated. Save only the codes below.
          </StatusNotice>
        )}
        {message && <StatusNotice tone="success" title="Saved action" live>{message}</StatusNotice>}
        {error && <StatusNotice tone="error" title="Recovery setup needs attention" live>{error}</StatusNotice>}

        <div className="recovery-public-id">
          <div><span>Public profile ID</span><code>{profile.id}</code></div>
          <AccessButton kind="quiet" icon="Copy" onClick={() => void copy('id')}>Copy ID</AccessButton>
        </div>
        <p className="recovery-public-id__note">This ID identifies your profile. It is public and is not enough to restore access.</p>

        {codes ? (
          <>
            <div className="recovery-code-heading">
              <div><h2>10 one-time recovery codes</h2><p>Each code restores one new installation, then becomes unusable.</p></div>
            </div>
            <RecoveryCodeGrid codes={codes} />
            <div className="recovery-kit-actions">
              <AccessButton kind="secondary" icon="Copy" onClick={() => void copy('kit')}>Copy recovery information</AccessButton>
              <AccessButton kind="secondary" icon="Download" onClick={() => downloadRecoveryKit(kitInput)}>Download recovery kit</AccessButton>
            </div>
          </>
        ) : (
          <StatusNotice tone="error" title="Recovery codes are not available">
            Generate a replacement batch before leaving this screen.
          </StatusNotice>
        )}

        <div className="recovery-finish">
          <AccessField
            id="recovery-display-name"
            label="Display name (optional)"
            hint="Stored with your pseudonymous profile. You can change or remove it later."
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="off"
            maxLength={80}
            placeholder="Leave blank to skip"
          />
          <label className="access-check">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>I have saved my recovery information</span>
          </label>
          <AccessButton onClick={() => void continueToApp()} disabled={!codes || !acknowledged || continuing}>
            {continuing ? 'Securing private access…' : 'Continue to InvaTrace'}
          </AccessButton>
          {syncMessage && (
            <AccessButton kind="quiet" onClick={() => void retryPendingStorage()}>Save installation again</AccessButton>
          )}
          {!codes && (
            <AccessButton kind="secondary" onClick={() => void reissueRecoveryCodes()}>Generate replacement codes</AccessButton>
          )}
        </div>
      </section>
    </AccessLayout>
  )
}
