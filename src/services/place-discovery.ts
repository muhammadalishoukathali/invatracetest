/** Iteration 2 Phase 5 - Epic 5.1 place-based plant discovery service.
 *
 *  Wraps the two backend endpoints:
 *
 *    GET /api/v1/places/{placeId}
 *    GET /api/v1/places/{placeId}/plant-associations
 *
 *  The server owns ranking, buffers and the mandatory disclaimer copy;
 *  the UI must never re-derive them. ``occurrenceDataUpdatedAt`` and the
 *  ``catalogueVersion`` fields are surfaced so PlaceAssociationsPage can
 *  attribute the inference. Never call these endpoints and then render
 *  results as a live census - that framing violates AC 5.1.6.
 */
import { useQuery } from '@tanstack/react-query'

import { api } from './api-client'

export type PlaceType = 'park' | 'forest' | 'reserve' | 'trail_area' | 'other'
export type GeometryStatus = 'authoritative' | 'sketch' | 'unsupported'
export type EvidenceKind = 'inside' | 'nearby' | 'upstream_waterway'

export type PlaceRecord = {
  placeId: string
  displayName: string
  placeType: PlaceType
  geometryStatus: GeometryStatus
  geometryVersion: string
}

export type EvidenceComponent = {
  kind: EvidenceKind
  distanceM: number | null
  weight: number
  qualifyingRecords: number
  mostRecentYear: number | null
}

export type PlantAssociation = {
  speciesId: string
  scientificName: string
  commonNames: string[]
  catalogueLink: string
  evidence: EvidenceComponent[]
  totalScore: number
  qualifyingRecords: number
  mostRecentYear: number | null
  closestDistanceM: number | null
  insideArea: boolean
  directionAwareEvidence: boolean
}

export type PlantAssociationsResponse = {
  place: PlaceRecord
  associations: PlantAssociation[]
  catalogueVersion: string
  occurrenceDataUpdatedAt: string | null
  disclaimer: string
}

export function usePlace(placeId: string | null | undefined) {
  return useQuery({
    queryKey: ['place', placeId] as const,
    queryFn: () => api<PlaceRecord>(`/api/v1/places/${encodeURIComponent(placeId!)}`),
    enabled: Boolean(placeId),
    staleTime: 10 * 60 * 1000,
  })
}

export function usePlantAssociations(placeId: string | null | undefined) {
  return useQuery({
    queryKey: ['place', placeId, 'plant-associations'] as const,
    queryFn: () =>
      api<PlantAssociationsResponse>(
        `/api/v1/places/${encodeURIComponent(placeId!)}/plant-associations`,
      ),
    // Occurrence data updates on an importer cadence (days at best), not a
    // per-session cadence. Cache aggressively; TanStack still refetches on
    // window focus for long-running tabs.
    enabled: Boolean(placeId),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  })
}
