import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { PrivateAccessLayout } from '@/features/private-access/components/PrivateAccessLayout'
import { PrivateAccessButton, PrivateAccessField, RecoveryCodeGrid, PrivateAccessNotice } from '@/features/private-access/components/PrivateAccessControls'
import { copyText, downloadRecoveryKit, recoveryKitText } from '@/features/private-access/recovery-kit'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { usePageHeadingFocus } from '@/hooks/usePageHeadingFocus'

export function RecoveryKitSetupPage() {
  const navigate = useNavigate()
  const headingRef = usePageHeadingFocus()
  const profile = usePrivateAccess((state) => state.profile)
  const installation = usePrivateAccess((state) => state.installation)
  const status = usePrivateAccess((state) => state.status)
  const codes = usePrivateAccess((state) => state.recoveryCodes)
  const batchCreatedAt = usePrivateAccess((state) => state.recoveryBatchCreatedAt)
  const recoveryWasReissued = usePrivateAccess((state) => state.recoveryWasReissued)
  const syncMessage = usePrivateAccess((state) => state.syncMessage)
  const acknowledgeRecovery = usePrivateAccess((state) => state.acknowledgeRecovery)
  const reissueRecoveryCodes = usePrivateAccess((state) => state.reissueRecoveryCodes)
  const retryPendingStorage = usePrivateAccess((state) => state.retryPendingStorage)
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '')
  const [acknowledged, setAcknowledged] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [continuing, setContinuing] = useState(false)

  if (status === 'ready') return <Navigate to="/map" replace />
  if (!profile || !installation) return <Navigate to="/private-access" replace />

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
      if (usePrivateAccess.getState().status === 'ready') navigate('/map', { replace: true })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Recovery setup could not be completed.')
    } finally {
      setContinuing(false)
    }
  }

  return (
    <PrivateAccessLayout>
      <section className="recovery-setup">
        <div className="recovery-setup__heading">
          <div>
            <h1 ref={headingRef} tabIndex={-1}>Save your recovery information</h1>
            <p>This is the only time InvaTrace will show this recovery-code batch.</p>
          </div>
          <span className="secret-badge">Secret</span>
        </div>

        {syncMessage && (
          <PrivateAccessNotice tone="warning" title="Recovery setup needs attention" live>{syncMessage}</PrivateAccessNotice>
        )}
        {recoveryWasReissued && codes && (
          <PrivateAccessNotice tone="info" title="A replacement batch was issued" live>
            Setup was interrupted, so every previously shown code was invalidated. Save only the codes below.
          </PrivateAccessNotice>
        )}
        {message && <PrivateAccessNotice tone="success" title="Saved action" live>{message}</PrivateAccessNotice>}
        {error && <PrivateAccessNotice tone="error" title="Recovery setup needs attention" live>{error}</PrivateAccessNotice>}

        <div className="recovery-public-id">
          <div><span>Public profile ID</span><code>{profile.id}</code></div>
          <PrivateAccessButton kind="quiet" icon="Copy" onClick={() => void copy('id')}>Copy ID</PrivateAccessButton>
        </div>
        <p className="recovery-public-id__note">This ID identifies your profile. It is public and is not enough to restore access.</p>

        {codes ? (
          <>
            <div className="recovery-code-heading">
              <div><h2>10 one-time recovery codes</h2><p>Each code restores one new installation, then becomes unusable.</p></div>
            </div>
            <RecoveryCodeGrid codes={codes} />
            <div className="recovery-kit-actions">
              <PrivateAccessButton kind="secondary" icon="Copy" onClick={() => void copy('kit')}>Copy recovery information</PrivateAccessButton>
              <PrivateAccessButton kind="secondary" icon="Download" onClick={() => downloadRecoveryKit(kitInput)}>Download recovery kit</PrivateAccessButton>
            </div>
          </>
        ) : (
          <PrivateAccessNotice tone="error" title="Recovery codes are not available">
            Generate a replacement batch before leaving this screen.
          </PrivateAccessNotice>
        )}

        <div className="recovery-finish">
          <PrivateAccessField
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
          <PrivateAccessButton onClick={() => void continueToApp()} disabled={!codes || !acknowledged || continuing}>
            {continuing ? 'Securing private access…' : 'Continue to InvaTrace'}
          </PrivateAccessButton>
          {syncMessage && (
            <PrivateAccessButton kind="quiet" onClick={() => void retryPendingStorage()}>Save installation again</PrivateAccessButton>
          )}
          {!codes && (
            <PrivateAccessButton kind="secondary" onClick={() => void reissueRecoveryCodes()}>Generate replacement codes</PrivateAccessButton>
          )}
        </div>
      </section>
    </PrivateAccessLayout>
  )
}
