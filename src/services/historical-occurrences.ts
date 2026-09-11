/** Phase 11B - Historical Records map layer service.
 *
 *  Wraps the read-only backend feed:
 *
 *    GET /api/v1/historical-occurrences?bbox=w,s,e,n&speciesId=&yearMin=&limit=
 *
 *  The response is a **separate** view from the community sightings feed
 *  (see services/api-client + ThreatMapPage). It surfaces cleaned GBIF
 *  occurrence points that have already passed the country=MY / present /
 *  coordinate-uncertainty ceiling filter during ingest, so the UI can
 *  render them as their own MapLibre layer without re-filtering.
 *
 *  Do not blend these points with the sightings source - historical
 *  observations do not guarantee current presence and must remain
 *  visually distinct (AC 5.1.6 spirit).
 */
import { useQuery } from '@tanstack/react-query'

import { api } from './api-client'

export type HistoricalOccurrence = {
  id: string
  speciesId: string
  scientificName: string
  commonName: string | null
  latitude: number
  longitude: number
  eventYear: number | null
  eventDate: string | null
  coordinateUncertaintyM: number | null
  basisOfRecord: string | null
  stateProvince: string | null
  datasetName: string | null
  licence: string | null
  sourceUrl: string | null
  recordUid: string | null
}

export type HistoricalOccurrencesResponse = {
  items: HistoricalOccurrence[]
  totalReturned: number
  truncated: boolean
  disclaimer: string
}

export type HistoricalOccurrencesQuery = {
  bbox?: [number, number, number, number] | null
  speciesId?: string | null
  yearMin?: number | null
  yearMax?: number | null
  limit?: number
}

export async function fetchHistoricalOccurrences(
  query: HistoricalOccurrencesQuery,
  signal?: AbortSignal,
): Promise<HistoricalOccurrencesResponse> {
  const params = new URLSearchParams()
  if (query.bbox) params.set('bbox', query.bbox.join(','))
  if (query.speciesId) params.set('species_id', query.speciesId)
  if (query.yearMin != null) params.set('year_min', String(query.yearMin))
  if (query.yearMax != null) params.set('year_max', String(query.yearMax))
  if (query.limit != null) params.set('limit', String(query.limit))
  const qs = params.toString()
  const url = `/api/v1/historical-occurrences${qs ? `?${qs}` : ''}`
  return api<HistoricalOccurrencesResponse>(url, { method: 'GET', signal })
}

export function useHistoricalOccurrences(
  query: HistoricalOccurrencesQuery,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      'historical-occurrences',
      query.bbox?.join(',') ?? null,
      query.speciesId ?? null,
      query.yearMin ?? null,
      query.yearMax ?? null,
      query.limit ?? 500,
    ],
    queryFn: ({ signal }) => fetchHistoricalOccurrences(query, signal),
    enabled,
    staleTime: 60_000,
    // Historical layer is opt-in; keep it cheap and cancel on nav.
    refetchOnWindowFocus: false,
  })
}
