import { Outlet, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useScan } from '@/features/scan/scan-store'
import './scan-flow.css'

export function ScanFlowLayout() {
  const navigate = useNavigate()
  const reset = useScan((s) => s.reset)

  const goBack = () => {
    reset()
    navigate(-1)
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
