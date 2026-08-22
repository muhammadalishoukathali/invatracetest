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
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--bg)',
    }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 16px', background: 'var(--surface)',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <button type="button" onClick={goBack} aria-label="Back" style={{
          width: 36, height: 36, borderRadius: 'var(--r-button)',
          border: '1px solid var(--border)', background: 'var(--surface)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="ChevronLeft" size={18} color="var(--body)" />
        </button>
        <h1 style={{ fontSize: 17, fontWeight: 700 }}>Scan a plant</h1>
      </header>

      <main style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Outlet />
      </main>
    </div>
  )
}
