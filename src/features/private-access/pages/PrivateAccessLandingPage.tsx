import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PrivateAccessLayout } from '@/features/private-access/components/PrivateAccessLayout'
import { PrivateAccessButton, PrivateAccessLink, PrivateAccessNotice } from '@/features/private-access/components/PrivateAccessControls'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { useOnline } from '@/hooks/useOnline'
import { usePageHeadingFocus } from '@/hooks/usePageHeadingFocus'

const PRIVATE_STEPS = [
  ['No personal account', 'We do not ask for your email, phone number, or legal name.'],
  ['One field identity', 'Reports and verification history stay connected through a public profile ID.'],
  ['Recovery stays with you', 'One-time recovery codes let you bring that profile to another device.'],
] as const

/** First screen a new or logged-out installation sees: explains the
 *  no-email/no-password identity model and offers to start a new private
 *  profile or hand off to RestorePrivateAccessPage.tsx. Rendered inside
 *  PrivateAccessRouteGuard.tsx, so it never shows to an already-ready profile. */
export function PrivateAccessLandingPage() {
  const navigate = useNavigate()
  const online = useOnline()
  const headingRef = usePageHeadingFocus()
  const status = usePrivateAccess((state) => state.status)
  const syncMessage = usePrivateAccess((state) => state.syncMessage)
  const startPrivate = usePrivateAccess((state) => state.startPrivate)
  const initialize = usePrivateAccess((state) => state.initialize)
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
    <PrivateAccessLayout>
      <div className="access-landing">
        <section className="access-intro">
          <p className="access-intro__eyebrow">Private by design</p>
          <h1 ref={headingRef} tabIndex={-1}>Field reporting without a personal account.</h1>
          <p className="access-intro__lead">
            Create a private field identity for invasive-species reports and verification history. No conventional registration required.
          </p>
          <div className="access-trust-line">
            <span>No email</span><span aria-hidden="true">·</span>
            <span>No phone number</span><span aria-hidden="true">·</span>
            <span>No legal name</span>
          </div>

          {!online && (
            <PrivateAccessNotice tone="warning" title="Connection needed">
              Starting or restoring access needs the network once. An established installation can still open offline.
            </PrivateAccessNotice>
          )}
          {status === 'revoked' && syncMessage && (
            <PrivateAccessNotice tone="warning" title="This installation is no longer active">{syncMessage}</PrivateAccessNotice>
          )}
          {status === 'storage-error' && (
            <PrivateAccessNotice tone="error" title="Private storage is unavailable">
              {syncMessage ?? 'Allow site storage before creating or restoring access.'}
            </PrivateAccessNotice>
          )}
          {error && <PrivateAccessNotice tone="error" title="Private access did not start" live>{error}</PrivateAccessNotice>}

          <div className="access-actions" aria-live="polite">
            <PrivateAccessButton onClick={() => void start()} disabled={!online || starting || status === 'storage-error'}>
              {starting ? 'Creating private access…' : 'Start privately'}
            </PrivateAccessButton>
            <PrivateAccessLink href="/private-access/restore">Restore existing access</PrivateAccessLink>
          </div>
          {status === 'storage-error' && (
            <PrivateAccessButton kind="quiet" onClick={() => void initialize()}>Check storage again</PrivateAccessButton>
          )}
        </section>

        <section className="access-trail" aria-labelledby="private-access-explained">
          <div className="access-trail__heading">
            <p>Before you begin</p>
            <h2 id="private-access-explained">Your identity stays separate from your personal details.</h2>
          </div>
          <ol>
            {PRIVATE_STEPS.map(([title, detail], index) => (
              <li key={title}>
                <span className="access-trail__marker" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <div><h3>{title}</h3><p>{detail}</p></div>
              </li>
            ))}
          </ol>
          <p className="access-trail__note">
            Your public profile ID is not a secret. Recovery codes are secret and each one works only once.
          </p>
        </section>
      </div>
    </PrivateAccessLayout>
  )
}
