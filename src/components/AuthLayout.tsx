import { Navigate, Outlet } from 'react-router-dom'
import { LogoWordmark } from './Logo'
import { useSession } from '@/lib/session'

export function AuthLayout() {
  const status = useSession((s) => s.status)

  if (status === 'authenticated') return <Navigate to="/map" replace />

  return (
    <div style={{
      minHeight: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24,
      background: 'var(--bg)',
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'center', marginBottom: 32,
        }}>
          <LogoWordmark size={22} />
        </div>

        <div style={{
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
