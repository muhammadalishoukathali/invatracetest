import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { RequirePrivateAccess } from '@/features/private-access/components/RequirePrivateAccess'
import { ScanFlowLayout } from '@/features/scan/ScanFlowLayout'
import { PrivateAccessRouteGuard } from '@/features/private-access/components/PrivateAccessRouteGuard'
import { PrivateAccessLandingPage } from '@/features/private-access/pages/PrivateAccessLandingPage'
import { RestorePrivateAccessPage } from '@/features/private-access/pages/RestorePrivateAccessPage'
import { RecoveryKitSetupPage } from '@/features/private-access/pages/RecoveryKitSetupPage'

// I lazy load these because MapLibre especially is a pretty big chunk, and
// bundling it into the main entry meant the private-access screen (which is
// the very first thing anyone sees) was loading way slower than it needed to
// on a bad connection. Splitting per route fixed that.
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
const PlaceAssociationsPage = lazy(() => import('@/features/discovery/PlaceAssociationsPage')
  .then((module) => ({ default: module.PlaceAssociationsPage })))
const OfflineSettingsPage = lazy(() => import('@/features/bestiary/offline/OfflineSettingsPage')
  .then((module) => ({ default: module.OfflineSettingsPage })))
const BestiaryPage = lazy(() => import('@/features/bestiary/BestiaryPage')
  .then((module) => ({ default: module.BestiaryPage })))
const PlantDetailPage = lazy(() => import('@/features/bestiary/PlantDetailPage')
  .then((module) => ({ default: module.PlantDetailPage })))
const AreasPage = lazy(() => import('@/features/areas/AreasPage')
  .then((module) => ({ default: module.AreasPage })))
const AreaDetailPage = lazy(() => import('@/features/areas/AreaDetailPage')
  .then((module) => ({ default: module.AreaDetailPage })))
const MyReportsPage = lazy(() => import('@/features/report/MyReportsPage')
  .then((module) => ({ default: module.MyReportsPage })))

// small helper so I don't have to wrap every single lazy route in its own
// Suspense manually - also means one slow chunk loading doesn't block AppShell
// or the rest of the route tree from rendering around it
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

// Route tree ended up in three groups, roughly matching the three states a
// user can be in. First is the /private-access flow for anyone without a
// profile yet - PrivateAccessRouteGuard redirects away from it once a
// profile exists so people can't land back on the setup screen. Second is
// the normal AppShell layout, gated by RequirePrivateAccess so nothing in
// here can render without a profile. Third is /scan and /report, which
// skip AppShell on purpose - for those I wanted a focused screen with no
// sidebar or tabs getting in the way while someone's mid-scan.
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
      { path: 'places/:placeId/plants', element: loadRoute(<PlaceAssociationsPage />) },
      { path: 'settings/offline', element: loadRoute(<OfflineSettingsPage />) },
      { path: 'plants', element: loadRoute(<BestiaryPage />) },
      { path: 'plants/:speciesId', element: loadRoute(<PlantDetailPage />) },
      { path: 'areas', element: loadRoute(<AreasPage />) },
      { path: 'areas/:adoptionId', element: loadRoute(<AreaDetailPage />) },
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
