import { Navigate } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { usePrivateAccess } from '@/features/private-access/private-access-store'

/** Wraps every route that needs a private profile (map, scan, report, etc.)
 *  and blocks rendering until this installation has one. There's no
 *  email/password login to gate on here — the "auth" state we're checking
 *  is whether private-access-store.ts resolved a valid installation/profile,
 *  so this is effectively the app's sign-in wall. */
export function RequirePrivateAccess({ children }: { children: React.ReactNode }) {
  const status = usePrivateAccess((state) => state.status)
  const profile = usePrivateAccess((state) => state.profile)

  if (status === 'initializing' || status === 'syncing') {
    return (
      <main aria-busy="true" aria-live="polite" style={stateLayout}>
        <Logo size={46} />
        <h1 style={stateTitle}>Preparing InvaTrace</h1>
        <p style={stateBody}>Restoring this installation…</p>
      </main>
    )
  }

  // Recovery codes were issued but never acknowledged as saved — don't let
  // the user into the app with codes they might not have written down.
  if (status === 'recovery') return <Navigate to="/private-access/recovery" replace />

  // We have a profile but couldn't persist the installation record locally
  // (e.g. IndexedDB write failed). Send to restore rather than pretending
  // this device is durably authorized when a refresh could lose the session.
  if (status === 'storage-error' && profile) {
    return <Navigate to="/private-access/restore" replace />
  }

  if (!profile) {
    return <Navigate to="/private-access" replace />
  }

  return <>{children}</>
}

const stateLayout: React.CSSProperties = {
  minHeight: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: 24,
  textAlign: 'center',
  background: 'var(--bg)',
}

const stateTitle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: '-0.02em',
}

const stateBody: React.CSSProperties = {
  maxWidth: '48ch',
  color: 'var(--body)',
  fontSize: 14,
}
