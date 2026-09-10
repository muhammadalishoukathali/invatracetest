/** Iteration 2 config/limits hook - single source of truth for every
 *  threshold and rate-limit constant the UI renders in copy or gates
 *  submissions on. AC 7.3.1 forbids hardcoded copies in the frontend;
 *  read from useLimits() instead. */
import { useQuery } from '@tanstack/react-query'

import { api } from './api-client'

export type ConfigLimits = {
  locationAccuracyMaxM: number
  removalProximityMaxM: number
  discoveryParkBufferM: number
  discoveryTrailBufferM: number
  discoveryDecayScaleM: number
  waterwayUpstreamMaxKm: number
  occurrenceCoordUncertaintyMaxM: number
  adoptionMaxPerIdentity: number
  adoptionRateLimitPerHour: number
  activityChangeTolerancePct: number
  removalRateLimitPerHour: number
  removalRateLimitPerDay: number
  removalIdempotencyWindowSeconds: number
  catalogueVersion: string
}

export const CONFIG_LIMITS_QUERY_KEY = ['config', 'limits'] as const

export function useLimits() {
  return useQuery({
    queryKey: CONFIG_LIMITS_QUERY_KEY,
    queryFn: () => api<ConfigLimits>('/api/v1/config/limits'),
    // Limits change with a deploy, not a session. Cache aggressively but
    // still let TanStack refetch on window focus if the tab was open for
    // a long time and a redeploy shipped meanwhile.
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  })
}
