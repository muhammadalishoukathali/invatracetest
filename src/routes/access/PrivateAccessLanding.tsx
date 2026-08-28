import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AccessLayout } from '@/components/access/AccessLayout'
import { AccessButton, AccessLink, StatusNotice } from '@/components/access/AccessUi'
import { Icon } from '@/components/Icon'
import { useIdentity } from '@/lib/identity'
import { useOnline } from '@/lib/useOnline'
import { usePageHeadingFocus } from '@/lib/usePageHeadingFocus'

const PRIVATE_STEPS = [
  ['Shield', 'Pseudonymous by default', 'No email, phone number, or legal name is required.'],
  ['ClipboardList', 'Connected evidence', 'Reports and activity stay linked to one opaque public profile ID.'],
  ['KeyRound', 'Recovery is in your hands', 'Saved one-time codes let another device restore the same profile.'],
] as const

export function PrivateAccessLanding() {
  const navigate = useNavigate()
  const online = useOnline()
  const headingRef = usePageHeadingFocus()
  const status = useIdentity((state) => state.status)
  const syncMessage = useIdentity((state) => state.syncMessage)
  const startPrivate = useIdentity((state) => state.startPrivate)
  const initialize = useIdentity((state) => state.initialize)
  const [error, setError] = useState<string | null>(null)
  const starting = status === 'starting'

  const start = async () => {
    setError(null)
    try {
      await startPrivate()
      navigate('/private-access/recovery', { replace: true })
    } catch {
      setError('We couldn’t start private access. Check your connection, then try again.')
    }
  }

  return (
    <AccessLayout>
      <div className="access-landing">
        <section className="access-intro">
          <h1 ref={headingRef} tabIndex={-1}>Use InvaTrace without email, phone, or a legal name</h1>
          <p className="access-intro__lead">
            Private access creates a pseudonymous profile for field reports and verification history—without conventional registration.
          </p>
          <div className="access-trust-line">
            <Icon name="Shield" size={18} color="var(--green)" />
            <span>No email. No phone number. No legal name.</span>
          </div>

          {!online && (
            <StatusNotice tone="warning" title="Connection needed">
              Starting or restoring access needs the network once. An established installation can still open offline.
            </StatusNotice>
          )}
          {status === 'revoked' && syncMessage && (
            <StatusNotice tone="warning" title="This installation is no longer active">{syncMessage}</StatusNotice>
          )}
          {status === 'storage-error' && (
            <StatusNotice tone="error" title="Private storage is unavailable">
              {syncMessage ?? 'Allow site storage before creating or restoring access.'}
            </StatusNotice>
          )}
          {error && <StatusNotice tone="error" title="Private access did not start" live>{error}</StatusNotice>}

          <div className="access-actions" aria-live="polite">
            <AccessButton onClick={() => void start()} disabled={!online || starting || status === 'storage-error'} icon="Leaf">
              {starting ? 'Creating private access…' : 'Start privately'}
            </AccessButton>
            <AccessLink href="/private-access/restore" icon="RefreshCw">Restore existing access</AccessLink>
          </div>
          {status === 'storage-error' && (
            <AccessButton kind="quiet" onClick={() => void initialize()}>Check storage again</AccessButton>
          )}
        </section>

        <section className="access-trail" aria-labelledby="private-access-explained">
          <h2 id="private-access-explained">How private access works</h2>
          <ol>
            {PRIVATE_STEPS.map(([icon, title, detail]) => (
              <li key={title}>
                <span className="access-trail__marker"><Icon name={icon} size={19} /></span>
                <div><h3>{title}</h3><p>{detail}</p></div>
              </li>
            ))}
          </ol>
          <p className="access-trail__note">
            Your public profile ID is not a secret. Recovery codes are secret and each one works only once.
          </p>
        </section>
      </div>
    </AccessLayout>
  )
}
