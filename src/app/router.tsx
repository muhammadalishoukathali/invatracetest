import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { RequirePrivateAccess } from '@/features/private-access/components/RequirePrivateAccess'
import { ScanFlowLayout } from '@/features/scan/ScanFlowLayout'
import { PrivateAccessRouteGuard } from '@/features/private-access/components/PrivateAccessRouteGuard'
import { PrivateAccessLandingPage } from '@/features/private-access/pages/PrivateAccessLandingPage'
import { RestorePrivateAccessPage } from '@/features/private-access/pages/RestorePrivateAccessPage'
import { RecoveryKitSetupPage } from '@/features/private-access/pages/RecoveryKitSetupPage'

// These screens are downloaded only when their route opens. Keeping MapLibre,
// scanning, reporting, and map code out of the first bundle makes the
// private-access screen usable sooner on a slow field connection.
const ThreatMapPage = lazy(() => import('@/features/map/ThreatMapPage')
  .then((module) => ({ default: module.ThreatMapPage })))
const AccessManagementPage = lazy(() => import('@/features/private-access/pages/AccessManagementPage')
  .then((module) => ({ default: module.AccessManagementPage })))
const ScanCapturePage = lazy(() => import('@/features/scan/ScanCapturePage')
  .then((module) => ({ default: module.ScanCapturePage })))
const ScanResultPage = lazy(() => import('@/features/scan/ScanResultPage')
  .then((module) => ({ default: module.ScanResultPage })))
const ReportWizardPage = lazy(() => import('@/features/report/ReportWizardPage')
  .then((module) => ({ default: module.ReportWizardPage })))
const ReportTrackingPage = lazy(() => import('@/features/report/ReportTrackingPage')
  .then((module) => ({ default: module.ReportTrackingPage })))
const MyReportsPage = lazy(() => import('@/features/report/MyReportsPage')
  .then((module) => ({ default: module.MyReportsPage })))

function loadRoute(content: ReactNode) {
  return <Suspense fallback={<RouteLoadingState />}>{content}</Suspense>
}

function RouteLoadingState() {
  return (
    <section className="route-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="route-loading__indicator" aria-hidden />
      <span>Loading this page…</span>
    </section>
  )
}

export const router = createBrowserRouter([
  {
    path: '/auth/*',
    element: <Navigate to="/private-access" replace />,
  },
  {
    path: '/private-access',
    element: <PrivateAccessRouteGuard />,
    children: [
      { index: true, element: <PrivateAccessLandingPage /> },
      { path: 'restore', element: <RestorePrivateAccessPage /> },
      { path: 'recovery', element: <RecoveryKitSetupPage /> },
    ],
  },
  {
    path: '/',
    element: <RequirePrivateAccess><AppShell /></RequirePrivateAccess>,
    children: [
      { index: true, element: <Navigate to="/map" replace /> },
      { path: 'map', element: loadRoute(<ThreatMapPage />) },
      { path: 'profile', element: loadRoute(<AccessManagementPage />) },
      { path: 'access', element: <Navigate to="/profile" replace /> },
      { path: 'reports', element: loadRoute(<MyReportsPage />) },
      { path: 'reports/:reportId', element: loadRoute(<ReportTrackingPage />) },
      { path: '*', element: <Navigate to="/map" replace /> },
    ],
  },
  {
    path: '/scan',
    element: <RequirePrivateAccess><ScanFlowLayout /></RequirePrivateAccess>,
    children: [
      { index: true, element: loadRoute(<ScanCapturePage />) },
      { path: 'result', element: loadRoute(<ScanResultPage />) },
    ],
  },
  {
    path: '/report',
    element: <RequirePrivateAccess>{loadRoute(<ReportWizardPage />)}</RequirePrivateAccess>,
  },
])
