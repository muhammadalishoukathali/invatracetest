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
}

export interface ActivitySnapshot {
  adoptionId: string
  placeId: string
  placeName: string
  placeType: string
  windowStartUtc: string
  windowEndUtc: string
  indicators: AdoptedAreaIndicators
  clusters: ActivityCluster[]
  markers: ActivityMarker[]
}

export type AdoptedAreaSort =
  | 'adopted_at'
  | 'active_sighting_count'
  | 'reports_new_30d'
  | 'place_name'

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

export function fetchAdoptionActivity(
  adoptionId: string,
): Promise<ActivitySnapshot> {
  return api<ActivitySnapshot>(`/api/v1/adopted-areas/${adoptionId}/activity`)
}
