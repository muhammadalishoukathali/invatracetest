import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { PrivateAccessLayout } from '@/features/private-access/components/PrivateAccessLayout'
import { PrivateAccessButton, PrivateAccessField, PrivateAccessNotice } from '@/features/private-access/components/PrivateAccessControls'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { useOnline } from '@/hooks/useOnline'
import { usePageHeadingFocus } from '@/hooks/usePageHeadingFocus'

const GENERIC_RESTORE_ERROR = 'We couldn’t restore this access. Check the profile ID and recovery code, then try again.'

export function RestorePrivateAccessPage() {
  const navigate = useNavigate()
  const online = useOnline()
  const headingRef = usePageHeadingFocus()
  const status = usePrivateAccess((state) => state.status)
  const profile = usePrivateAccess((state) => state.profile)
  const syncMessage = usePrivateAccess((state) => state.syncMessage)
  const restorePrivate = usePrivateAccess((state) => state.restorePrivate)
  const retryPendingStorage = usePrivateAccess((state) => state.retryPendingStorage)
  const [profileId, setProfileId] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const restoring = status === 'restoring'

  if (status === 'ready' && !success) return <Navigate to="/map" replace />

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!profileId.trim() || !recoveryCode.trim()) {
      setError(GENERIC_RESTORE_ERROR)
      return
    }
    try {
      await restorePrivate(profileId, recoveryCode)
      if (usePrivateAccess.getState().status === 'ready') {
        setSuccess(true)
        window.setTimeout(() => navigate('/map', { replace: true }), 650)
      }
    } catch {
      setError(GENERIC_RESTORE_ERROR)
    }
  }

  const retryStorage = async () => {
    if (await retryPendingStorage()) {
      setSuccess(true)
      window.setTimeout(() => navigate('/map', { replace: true }), 650)
    }
  }

  return (
    <PrivateAccessLayout compact>
      <section className="access-form-panel">
        <Link className="access-back-link" to="/private-access">
          <span aria-hidden="true">←</span>
          <span>Private access</span>
        </Link>
        <h1 ref={headingRef} tabIndex={-1}>Restore existing access</h1>
        <p className="access-form-panel__lead">
          Use the public profile ID and one unused recovery code. This device becomes an additional active installation.
        </p>

        {success && (
          <PrivateAccessNotice tone="success" title="Access restored" live>
            Opening your InvaTrace profile. Earlier installations remain active.
          </PrivateAccessNotice>
        )}
        {!online && (
          <PrivateAccessNotice tone="warning" title="Connection needed">
            Restoring a profile requires the network once. Reconnect to continue.
          </PrivateAccessNotice>
        )}
        {status === 'storage-error' && profile && (
          <PrivateAccessNotice tone="error" title="Allow private browser storage" live>
            {syncMessage ?? 'The restored installation could not be saved on this device.'}
          </PrivateAccessNotice>
        )}
        {error && <PrivateAccessNotice tone="error" title="Access was not restored" live>{error}</PrivateAccessNotice>}

        {status === 'storage-error' && profile ? (
          <PrivateAccessButton onClick={() => void retryStorage()}>Save this installation again</PrivateAccessButton>
        ) : (
          <form className="access-form" onSubmit={(event) => void submit(event)} noValidate>
            <PrivateAccessField
              id="restore-profile-id"
              label="Public profile ID"
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={80}
              placeholder="IVT-…"
            />
            <PrivateAccessField
              id="restore-recovery-code"
              label="One recovery code"
              hint="A recovery code is secret and can be used only once."
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX"
            />
            <PrivateAccessButton type="submit" disabled={!online || restoring}>
              {restoring ? 'Restoring access…' : 'Restore access'}
            </PrivateAccessButton>
          </form>
        )}

        <p className="access-privacy-note">
          For privacy, InvaTrace shows the same message whether the profile ID, code, or code status is incorrect.
        </p>
      </section>
    </PrivateAccessLayout>
  )
}
