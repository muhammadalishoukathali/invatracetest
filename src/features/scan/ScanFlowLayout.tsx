import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useScan } from '@/features/scan/scan-store'
import { scanReturnPath } from '@/features/scan/scan-navigation'
import './scan-flow.css'

/**
 * Shared shell for the whole scan flow (capture -> processing -> result):
 * renders the header with the back button and hosts the nested route via
 * Outlet. The back button's behaviour differs by step — from the result
 * screen it steps back to capture instead of leaving the flow entirely —
 * and falls back to scan-navigation.ts to figure out where to go once the
 * user actually exits.
 */
export function ScanFlowLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const reset = useScan((s) => s.reset)

  const goBack = () => {
    if (location.pathname === '/scan/result') {
      navigate('/scan', { state: location.state })
      return
    }
    reset()
    navigate(scanReturnPath(location.state), { replace: true })
  }

  return (
    <div className="scan-flow">
      <header className="scan-flow__header">
        <div className="scan-flow__header-inner">
          <button type="button" onClick={goBack} aria-label="Go back" className="scan-flow__back">
            <Icon name="ChevronLeft" size={18} color="var(--body)" />
          </button>
          <h1>Scan a plant</h1>
        </div>
      </header>

      <main className="scan-flow__main">
        <Outlet />
      </main>
    </div>
  )
}
