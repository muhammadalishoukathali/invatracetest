import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AccessLayout } from '@/components/access/AccessLayout'
import { AccessButton, AccessField, StatusNotice } from '@/components/access/AccessUi'
import { useIdentity } from '@/lib/identity'
import { useOnline } from '@/lib/useOnline'
import { usePageHeadingFocus } from '@/lib/usePageHeadingFocus'
import { Icon } from '@/components/Icon'

const GENERIC_RESTORE_ERROR = 'We couldn’t restore this access. Check the profile ID and recovery code, then try again.'

export function RestorePrivateAccess() {
  const navigate = useNavigate()
  const online = useOnline()
  const headingRef = usePageHeadingFocus()
  const status = useIdentity((state) => state.status)
  const profile = useIdentity((state) => state.profile)
  const syncMessage = useIdentity((state) => state.syncMessage)
  const restorePrivate = useIdentity((state) => state.restorePrivate)
  const retryPendingStorage = useIdentity((state) => state.retryPendingStorage)
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
      if (useIdentity.getState().status === 'ready') {
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
    <AccessLayout compact>
      <section className="access-form-panel">
        <a className="access-back-link" href="/private-access">
          <Icon name="ChevronLeft" size={17} />
          <span>Back to private access</span>
        </a>
        <h1 ref={headingRef} tabIndex={-1}>Restore existing access</h1>
        <p className="access-form-panel__lead">
          Use the public profile ID and one unused recovery code. This device becomes an additional active installation.
        </p>

        {success && (
          <StatusNotice tone="success" title="Access restored" live>
            Opening your InvaTrace profile. Earlier installations remain active.
          </StatusNotice>
        )}
        {!online && (
          <StatusNotice tone="warning" title="Connection needed">
            Restoring a profile requires the network once. Reconnect to continue.
          </StatusNotice>
        )}
        {status === 'storage-error' && profile && (
          <StatusNotice tone="error" title="Allow private browser storage" live>
            {syncMessage ?? 'The restored installation could not be saved on this device.'}
          </StatusNotice>
        )}
        {error && <StatusNotice tone="error" title="Access was not restored" live>{error}</StatusNotice>}

        {status === 'storage-error' && profile ? (
          <AccessButton onClick={() => void retryStorage()}>Save this installation again</AccessButton>
        ) : (
          <form className="access-form" onSubmit={(event) => void submit(event)} noValidate>
            <AccessField
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
            <AccessField
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
            <AccessButton type="submit" disabled={!online || restoring}>
              {restoring ? 'Restoring access…' : 'Restore access'}
            </AccessButton>
          </form>
        )}

        <p className="access-privacy-note">
          For privacy, InvaTrace shows the same message whether the profile ID, code, or code status is incorrect.
        </p>
      </section>
    </AccessLayout>
  )
}
