/** Iteration 2 evidence-catalogue hooks. The 32-species catalogue backing
 *  the bestiary, plant-detail deep-link, and place-discovery cards. The
 *  server is authoritative for the version + reviewed date; we never
 *  hardcode either in copy (AC 5.2.1, 5.2.6). */
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { api } from './api-client'

export type EvidenceCode = 'G' | 'A' | 'B'

export type CatalogueSpecies = {
  speciesId: string
  scientificName: string
  acceptedNameUsage?: string | null
  commonNames: string[]
  evidenceCodes: EvidenceCode[]
  evidenceSources: string[]
  malaysianStates: string[]
  habitat?: string | null
  referenceImageUrl?: string | null
}

/** AC 5.2.5 - one structured source rendered by the bestiary drawer. */
export type SourceEntry = {
  title: string
  urlOrId: string
  imageCreator?: string | null
  licence?: string | null
  reviewDate?: string | null
}

export type CatalogueDetail = CatalogueSpecies & {
  identifyingCharacteristics?: string | null
  typicalHabitat?: string | null
  documentedImpacts?: string | null
  imageAttribution?: Record<string, unknown> | null
  formalSeverityAssessmentAvailable: boolean
  beginnerSafeActionAvailable: boolean
  lastReviewedAt?: string | null
  sources?: SourceEntry[]
}

export type CatalogueListResponse = {
  catalogueVersion: string
  reviewedAt: string
  totalSpeciesCount: number
  items: CatalogueSpecies[]
}

export const CATALOGUE_QUERY_KEY = ['catalogue'] as const

export function useCatalogue() {
  return useQuery({
    queryKey: CATALOGUE_QUERY_KEY,
    queryFn: () => api<CatalogueListResponse>('/api/v1/catalogue'),
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  })
}

export function useCatalogueSearch(query: string) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: [...CATALOGUE_QUERY_KEY, 'search', trimmed],
    queryFn: () =>
      api<CatalogueListResponse>(
        `/api/v1/catalogue/search${trimmed ? `?q=${encodeURIComponent(trimmed)}` : ''}`,
      ),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useCatalogueDetail(speciesId: string | undefined) {
  return useQuery({
    queryKey: [...CATALOGUE_QUERY_KEY, 'detail', speciesId ?? ''],
    queryFn: () => api<CatalogueDetail>(`/api/v1/catalogue/${speciesId}`),
    enabled: Boolean(speciesId),
    staleTime: 5 * 60 * 1000,
  })
}
