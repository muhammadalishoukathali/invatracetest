import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { RequireIdentity } from '@/components/RequireIdentity'
import { RequireRole } from '@/components/RequireRole'
import { ScanLayout } from '@/routes/scan/ScanLayout'
import { Capture } from '@/routes/scan/Capture'
import { Result } from '@/routes/scan/Result'
import { ReportLayout } from '@/routes/report/ReportLayout'
import { MapView } from '@/routes/map/MapView'
import { VerifyQueue } from '@/routes/verify/VerifyQueue'
import { PrivateAccessGate } from '@/components/access/PrivateAccessGate'
import { PrivateAccessLanding } from '@/routes/access/PrivateAccessLanding'
import { RestorePrivateAccess } from '@/routes/access/RestorePrivateAccess'
import { RecoverySetup } from '@/routes/access/RecoverySetup'
import { AccessManagement } from '@/routes/access/AccessManagement'

export const router = createBrowserRouter([
  {
    path: '/auth/*',
    element: <Navigate to="/private-access" replace />,
  },
  {
    path: '/private-access',
    element: <PrivateAccessGate />,
    children: [
      { index: true, element: <PrivateAccessLanding /> },
      { path: 'restore', element: <RestorePrivateAccess /> },
      { path: 'recovery', element: <RecoverySetup /> },
    ],
  },
  {
    path: '/',
    element: <RequireIdentity><AppShell /></RequireIdentity>,
    children: [
      { index: true, element: <Navigate to="/map" replace /> },
      { path: 'map', element: <MapView /> },
      { path: 'access', element: <AccessManagement /> },
      { path: 'verify', element: (
        <RequireRole roles={['Coordinator', 'Expert', 'Admin']}>
          <VerifyQueue />
        </RequireRole>
      ) },
      { path: '*', element: <Navigate to="/map" replace /> },
    ],
  },
  {
    path: '/scan',
    element: <RequireIdentity><ScanLayout /></RequireIdentity>,
    children: [
      { index: true, element: <Capture /> },
      { path: 'result', element: <Result /> },
    ],
  },
  {
    path: '/report',
    element: <RequireIdentity><ReportLayout /></RequireIdentity>,
  },
])
