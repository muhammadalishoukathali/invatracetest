import { Navigate, Outlet } from 'react-router-dom'
import { LogoWordmark } from './Logo'
import { useSession } from '@/lib/session'

export function AuthLayout() {
  const status = useSession((s) => s.status)

  if (status === 'authenticated') return <Navigate to="/map" replace />

  return (
    <div className="auth-layout" style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', overflowY: 'auto',
      padding: 'max(20px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
      background: 'var(--bg)',
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'center', marginBottom: 32,
        }}>
          <LogoWordmark size={22} />
        </div>

        <div className="auth-card" style={{
          background: 'var(--surface)', borderRadius: 'var(--r-card)',
          border: '1px solid var(--border)', padding: '32px 28px',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <Outlet />
        </div>
      </div>
    </div>
  )
}
