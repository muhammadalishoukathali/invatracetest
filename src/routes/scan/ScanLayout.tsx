import { Outlet, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useScan } from '@/lib/scan-store'

export function ScanLayout() {
  const navigate = useNavigate()
  const reset = useScan((s) => s.reset)

  const goBack = () => {
    reset()
    navigate(-1)
  }

  return (
    <div style={{
      minHeight: '100dvh', height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg)',
    }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 16px', background: 'var(--surface)',
        paddingTop: 'calc(12px + env(safe-area-inset-top))',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <button type="button" onClick={goBack} aria-label="Back" style={{
          width: 44, height: 44, borderRadius: 'var(--r-button)',
          border: '1px solid var(--control-border)', background: 'var(--surface)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="ChevronLeft" size={18} color="var(--body)" />
        </button>
        <h1 style={{ fontSize: 17, fontWeight: 700 }}>Scan a plant</h1>
      </header>

      <main style={{
        flex: 1, minHeight: 0, overflow: 'auto',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        <Outlet />
      </main>
    </div>
  )
}
