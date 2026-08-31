import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useScan } from '@/features/scan/scan-store'
import './scan-flow.css'

export function ScanFlowLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const reset = useScan((s) => s.reset)

  const goBack = () => {
    // From /scan/result, back returns to the capture screen (photo preserved
    // in the store) so the user can retake or re-analyse without losing state.
    // From /scan, back returns to the map and clears any half-loaded capture.
    if (location.pathname === '/scan/result') {
      navigate('/scan')
      return
    }
    reset()
    navigate('/map')
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
