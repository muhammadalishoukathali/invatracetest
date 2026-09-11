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

export type EvidenceCodeShort = 'G' | 'A' | 'B'

/** Wave 2c per-item rank breakdown surfaced by the backend so the UI can
 *  render tier/upstream diagnostics without re-deriving weights. */
export type RankComponents = {
  tier: number
  nearbyComponent?: number
  upstreamComponent?: number
}

/** Wave 2c evidence record — extended shape carrying provenance for the
 *  sources sub-drawer (occurrence uid, source URL, licence). */
export type EvidenceRecord = {
  type: string
  distanceM?: number
  networkDistanceM?: number
  occurrenceRecordUid?: string
  sourceUrl?: string
  licence?: string
}

export type PlantAssociation = {
  speciesId: string
  scientificName: string
  commonNames: string[]
  catalogueLink: string
  /** AC 5.1.6 - reference image URL or null when the species has none yet. */
  referenceImageUrl?: string | null
  /** AC 5.1.6 - Malaysian invasive-status evidence codes (G/A/B). */
  evidenceCodes: EvidenceCodeShort[]
  /** AC 5.1.6 - Malaysian states where the species is documented. */
  malaysianStates: string[]
  evidence: EvidenceComponent[]
  totalScore: number
  qualifyingRecords: number
  mostRecentYear: number | null
  closestDistanceM: number | null
  insideArea: boolean
  directionAwareEvidence: boolean
  /** Wave 2c — per-item rank breakdown. Optional; older backends omit. */
  rankComponents?: RankComponents
  /** Wave 2c — per-record evidence with provenance. Optional. */
  evidenceRecords?: EvidenceRecord[]
}

export type PlantAssociationsResponse = {
  place: PlaceRecord
  associations: PlantAssociation[]
  catalogueVersion: string
  occurrenceDataUpdatedAt: string | null
  disclaimer: string
  /** Wave 2c — free-text interpretation string. Optional. */
  interpretation?: string
  /** Wave 2c — processed occurrence data version identifier. Optional. */
  processedDataVersion?: string
  /** Wave 2c — OSM boundary/source version. Optional. */
  osmSourceVersion?: string
}

/** Wave 2c — Places index item returned by the viewport search endpoint. */
export type PlaceListItem = {
  placeId: string
  displayName: string
  placeType: 'park' | 'forest' | 'trail'
  sourceFeatureId: string | null
  geometryStatus: string
  source: string
  sourceVersion: string
  geometrySimplified: GeoJSON.Geometry
}

export type PlacesListResponse = { items: PlaceListItem[] }

export type UsePlacesParams = {
  q?: string
  placeType?: 'park' | 'forest' | 'trail'
  bbox?: [number, number, number, number]
  limit?: number
}

/** Wave 2c — viewport/query-driven place index. Debouncing is a consumer
 *  concern (the map viewport listener owns it) so this hook is naive. */
export function usePlaces(params: UsePlacesParams) {
  const { q, placeType, bbox, limit } = params
  const enabled = Boolean(bbox) || Boolean(q)
  return useQuery({
    queryKey: ['places', q ?? null, placeType ?? null, bbox ?? null, limit ?? null] as const,
    queryFn: () => {
      const search = new URLSearchParams()
      if (q) search.set('q', q)
      if (placeType) search.set('place_type', placeType)
      if (bbox) search.set('bbox', bbox.join(','))
      if (typeof limit === 'number') search.set('limit', String(limit))
      const qs = search.toString()
      return api<PlacesListResponse>(`/api/v1/places${qs ? `?${qs}` : ''}`)
    },
    enabled,
    staleTime: 60_000,
  })
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
