import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { AuthLayout } from '@/components/AuthLayout'
import { RequireAuth } from '@/components/RequireAuth'
import { RequireRole } from '@/components/RequireRole'
import { SignIn } from '@/routes/SignIn'
import { CreateAccount } from '@/routes/CreateAccount'
import { ScanLayout } from '@/routes/scan/ScanLayout'
import { Capture } from '@/routes/scan/Capture'
import { Result } from '@/routes/scan/Result'
import { ReportLayout } from '@/routes/report/ReportLayout'
import { MapView } from '@/routes/map/MapView'
import { VerifyQueue } from '@/routes/verify/VerifyQueue'

export const router = createBrowserRouter([
  {
    path: '/auth',
    element: <AuthLayout />,
    children: [
      { index: true, element: <Navigate to="/auth/sign-in" replace /> },
      { path: 'sign-in', element: <SignIn /> },
      { path: 'create', element: <CreateAccount /> },
    ],
  },
  {
    path: '/',
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      { index: true, element: <Navigate to="/map" replace /> },
      { path: 'map', element: <MapView /> },
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
    element: <RequireAuth><ScanLayout /></RequireAuth>,
    children: [
      { index: true, element: <Capture /> },
      { path: 'result', element: <Result /> },
    ],
  },
  {
    path: '/report',
    element: <RequireAuth><ReportLayout /></RequireAuth>,
  },
])
