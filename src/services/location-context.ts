/** Iteration 2 Phase 3 - Epic 3 safe response location context.
 *
 *  Wraps POST /api/v1/location-context. The server is authoritative on the
 *  accuracy ceiling and the polygon dataset - never re-derive either
 *  client-side. ``action_eligible`` from this call is only ever ``false``
 *  today; the guidance panel flips it to ``true`` only after its own
 *  explicit-permission gate closes. The three states below drive the
 *  LocationContextCard copy in ``src/features/scan``.
 */
import { useMutation } from '@tanstack/react-query'

import { api } from './api-client'

export type LocationContextState =
  | 'inside_protected_area'
  | 'no_intersection'
  | 'boundary_uncertain'

export type LocationContextRequest = {
  latitude: number
  longitude: number
  accuracyM: number
}

export type LocationContextResult = {
  contextState: LocationContextState
  actionEligible: boolean
  boundarySource: string | null
  boundaryVersion: string | null
  boundaryName: string | null
  // ISO datetime; ``null`` on fail-closed paths where no boundary row was
  // consulted. Server-owned - AC 3.3.5 forbids the UI inventing this.
  boundaryUpdatedAt: string | null
  checkedAt: string
  accuracyCeilingM: number
  // Server echoes the accuracy_m the client sent so the UI can't drift.
  gpsAccuracyM: number
}

export async function fetchLocationContext(
  body: LocationContextRequest,
): Promise<LocationContextResult> {
  return api<LocationContextResult>('/api/v1/location-context', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function useLocationContextMutation() {
  return useMutation({
    mutationFn: fetchLocationContext,
  })
}
