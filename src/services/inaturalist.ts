/**
 * Fetch the canonical iNaturalist "default photo" for a species by its
 * scientific name. iNaturalist is one of the reference-image sources
 * approved in the InvaTrace Data Management Plan (Iteration 2, §"iNaturalist
 * Open Data") - photos come from iNaturalist Open Data on S3 and carry a
 * Creative Commons licence. This module is the primary source of species
 * photos on the plant detail page.
 *
 * Uses the public API (no auth) and caches per session via React Query.
 * Falls back gracefully - callers should render the catalogue's own
 * reference image whenever `data` is null.
 */
import { useQuery } from '@tanstack/react-query'

export interface INatPhoto {
  mediumUrl: string
  originalUrl: string
  attribution: string
  licenceCode: string | null
  sourceUrl: string
}

interface RawTaxon {
  name?: string
  matched_term?: string
  default_photo?: {
    medium_url?: string
    original_url?: string
    url?: string
    attribution?: string
    license_code?: string
  } | null
  id?: number
}

interface RawTaxaResponse {
  results?: RawTaxon[]
}

async function fetchTaxonPhoto(scientificName: string): Promise<INatPhoto | null> {
  const q = encodeURIComponent(scientificName)
  const url = `https://api.inaturalist.org/v1/taxa?q=${q}&rank=species&per_page=3`
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) return null
  const body = (await response.json()) as RawTaxaResponse
  const results = body.results ?? []
  // Prefer an exact scientific-name match over the top result; iNat's search
  // ranking otherwise returns near-neighbours (same genus, wrong species).
  const target = scientificName.toLowerCase()
  const exact = results.find((r) => (r.name ?? '').toLowerCase() === target)
  const chosen = exact ?? results[0]
  const photo = chosen?.default_photo
  if (!chosen || !photo) return null
  const medium = photo.medium_url ?? photo.url ?? photo.original_url
  if (!medium) return null
  return {
    mediumUrl: medium,
    originalUrl: photo.original_url ?? medium,
    attribution: photo.attribution ?? 'iNaturalist',
    licenceCode: photo.license_code ?? null,
    sourceUrl: chosen.id ? `https://www.inaturalist.org/taxa/${chosen.id}` : 'https://www.inaturalist.org/',
  }
}

export function useINaturalistPhoto(scientificName: string | null | undefined) {
  return useQuery<INatPhoto | null>({
    queryKey: ['inaturalist', 'taxon-photo', scientificName ?? ''],
    queryFn: () => fetchTaxonPhoto(scientificName!),
    enabled: Boolean(scientificName),
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  })
}
