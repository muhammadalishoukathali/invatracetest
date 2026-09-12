/** Iteration 2 Phase 7 - Epic 6 adopted-areas client.
 *
 *  Thin wrapper over the four backend endpoints. Kept in /services
 *  rather than /features/areas so the ReportSubmissionResult adopt
 *  prompt can reach it without dragging the whole feature module in.
 */
import { api } from './api-client'

export type ChangeDirection =
  | 'increase'
  | 'decrease'
  | 'unchanged'
  | 'insufficient_history'

export interface AdoptedAreaIndicators {
  activeSightingCount: number
  distinctSpeciesCount: number
  reportsNew30d: number
  removalReported30d: number
  daysSinceMostRecent: number | null
  mostRecentReportDate: string | null
  reportsPrevious30d: number
  changeDirection: ChangeDirection
  changePct: number | null
  tolerancePct: number
  windowDays: number
}

export interface AdoptedAreaSummary {
  adoptionId: string
  placeId: string
  placeName: string
  placeType: string
  adoptedAt: string
  indicators: AdoptedAreaIndicators
}

export interface AdoptedAreaList {
  items: AdoptedAreaSummary[]
  total: number
  maxPerIdentity: number
}

export interface AdoptionCreated {
  adoptionId: string
  placeId: string
  placeName: string
  adoptedAt: string
}

export interface ActivityCluster {
  clusterId: number
  pointCount: number
  centroidLat: number
  centroidLon: number
  speciesIds: string[]
}

export interface ActivityMarker {
  sightingId: string
  speciesId: string
  status: string
  latitude: number
  longitude: number
  observedAt: string
  clusterId: number | null
  // AC 6.3.2 - human-readable marker detail so the UI does not need to
  // look up the species table for a marker popover.
  plantName: string
  plantCommonName: string | null
  communityReportLabel: string
  observationDate: string
  currentStatus: string
  statusDate: string
}

export interface ActivitySnapshot {
  adoptionId: string
  placeId: string
  placeName: string
  placeType: string
  windowStartUtc: string
  windowEndUtc: string
  // AC 6.3.1 - polygon boundary versioned + returned as GeoJSON so the
  // client can cache by geometry_version.
  geometryVersion: string
  geometryGeojson: string | null
  indicators: AdoptedAreaIndicators
  clusters: ActivityCluster[]
  markers: ActivityMarker[]
}

export type AdoptedAreaSort =
  | 'adopted_at'
  | 'active_sighting_count'
  | 'reports_new_30d'
  | 'place_name'
  | 'recent_activity'

export function listAdoptedAreas(
  sort: AdoptedAreaSort = 'adopted_at',
): Promise<AdoptedAreaList> {
  const params = new URLSearchParams({ sort })
  return api<AdoptedAreaList>(`/api/v1/adopted-areas?${params.toString()}`)
}

export function adoptArea(placeId: string): Promise<AdoptionCreated> {
  return api<AdoptionCreated>('/api/v1/adopted-areas', {
    method: 'POST',
    body: JSON.stringify({ placeId }),
  })
}

export function removeAdoption(adoptionId: string): Promise<void> {
  return api<void>(`/api/v1/adopted-areas/${adoptionId}`, {
    method: 'DELETE',
  })
}

// AC 6.3.3 - client-selectable filters. Backend accepts species_id
// (aliased to `plant` in code), status and period_days.
export interface AdoptionActivityFilters {
  speciesId?: string | null
  status?: string | null
  periodDays?: number | null
}

export function fetchAdoptionActivity(
  adoptionId: string,
  filters: AdoptionActivityFilters = {},
): Promise<ActivitySnapshot> {
  const params = new URLSearchParams()
  if (filters.speciesId) params.set('species_id', filters.speciesId)
  if (filters.status) params.set('status', filters.status)
  if (filters.periodDays != null) params.set('period_days', String(filters.periodDays))
  const qs = params.toString()
  const url = qs
    ? `/api/v1/adopted-areas/${adoptionId}/activity?${qs}`
    : `/api/v1/adopted-areas/${adoptionId}/activity`
  return api<ActivitySnapshot>(url)
}
