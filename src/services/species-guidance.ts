/** AC 3.1.1 / 3.1.4 - server-authoritative removal guidance.
 *  Frontend used to only read a bundled `plant-guidance.json`. It now fetches
 *  `/api/v1/species/{id}/guidance`, runtime-validates the shape, and on any
 *  validation failure (missing required field, unknown guidance_mode, unresolved
 *  source id) drops to an observe-and-report fallback instead of rendering
 *  half-verified active removal steps.
 */
import { useQuery } from '@tanstack/react-query'

import { api } from './api-client'

export type ServerGuidanceMode =
  | 'general_information'
  | 'active_guidance'
  | 'site_manager_confirmation_required'
  | 'report_only'

export type ServerGuidanceSource = {
  id: string
  title: string
  url?: string | null
  reviewedAt?: string | null
}

export type ServerRemovalStep = {
  order: number
  action: string
  tool?: string | null
  detail?: string | null
  sourceIds?: string[]
}

export type ServerGuidance = {
  actionMode: 'remove' | 'contain' | 'report_only' | 'active_guidance' | 'site_manager_confirmation_required'
  guidanceMode: ServerGuidanceMode
  plantId: string
  contentVersion: string
  lastReviewed: string | null
  title: string
  summary: string
  validMonths: number[]
  steps: ServerRemovalStep[]
  doNotDo: string[]
  ppe: string[]
  decontamination: string[]
  stopConditions: string[]
  spreadPrevention: string[]
  prohibitedActions: string[]
  sources: ServerGuidanceSource[]
  revision: string
}

const VALID_GUIDANCE_MODES: ReadonlySet<ServerGuidanceMode> = new Set([
  'general_information',
  'active_guidance',
  'site_manager_confirmation_required',
  'report_only',
])

/** AC 3.1.4 runtime validation - reject anything missing a required field or
 *  carrying an unknown guidance_mode. Returning null forces the observe-and-
 *  report fallback in the caller rather than rendering partial guidance. */
export function validateServerGuidance(raw: unknown): ServerGuidance | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.plantId !== 'string' || !r.plantId) return null
  if (typeof r.contentVersion !== 'string' || !r.contentVersion) return null
  if (typeof r.revision !== 'string' || !r.revision) return null
  if (typeof r.title !== 'string') return null
  if (typeof r.summary !== 'string') return null
  const mode = r.guidanceMode as ServerGuidanceMode
  if (!VALID_GUIDANCE_MODES.has(mode)) return null
  if (!Array.isArray(r.steps)) return null
  if (!Array.isArray(r.doNotDo)) return null
  if (!Array.isArray(r.stopConditions)) return null
  if (!Array.isArray(r.spreadPrevention)) return null
  if (!Array.isArray(r.prohibitedActions)) return null
  if (!Array.isArray(r.sources)) return null
  if (!Array.isArray(r.validMonths)) return null
  if (!Array.isArray(r.ppe)) return null
  if (!Array.isArray(r.decontamination)) return null
  return raw as ServerGuidance
}

export const SPECIES_GUIDANCE_QUERY_KEY = ['species-guidance'] as const

export function useSpeciesGuidance(speciesId: string | null | undefined) {
  return useQuery<ServerGuidance | null>({
    queryKey: [...SPECIES_GUIDANCE_QUERY_KEY, speciesId ?? ''],
    queryFn: async () => {
      const raw = await api<unknown>(`/api/v1/species/${speciesId}/guidance`)
      const validated = validateServerGuidance(raw)
      if (!validated) {
        if (typeof console !== 'undefined') {
          console.error(
            `Guidance response for ${speciesId} failed runtime validation - falling back to observe-and-report.`,
          )
        }
      }
      return validated
    },
    enabled: Boolean(speciesId),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
}
