/**
 * Wikipedia REST summary fetch for a species by scientific name. Used as
 * the last-resort fallback source of a short, human-written description
 * on the plant detail page when the curated plant-guidance dataset has no
 * entry and the backend catalogue's identifying / habitat / impacts
 * fields are null. Wikipedia is linked from the DMP-approved iNaturalist
 * taxa payload (each iNaturalist taxon carries a wikipedia_url), so we
 * reach for the same article that the DMP source already points at.
 *
 * The REST summary endpoint supports CORS and returns a plain-language
 * two-to-four-sentence extract plus a shortDescription. We render the
 * extract and always attribute Wikipedia + CC BY-SA under the paragraph.
 */
import { useQuery } from '@tanstack/react-query'

export interface WikipediaSummary {
  title: string
  extract: string
  description: string | null
  pageUrl: string
}

interface RawSummary {
  title?: string
  extract?: string
  description?: string
  content_urls?: { desktop?: { page?: string }; mobile?: { page?: string } }
  type?: string
}

async function fetchSummary(scientificName: string): Promise<WikipediaSummary | null> {
  const slug = encodeURIComponent(scientificName.replace(/\s+/g, '_'))
  const response = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`,
    { headers: { Accept: 'application/json' } },
  )
  if (!response.ok) return null
  const body = (await response.json()) as RawSummary
  // "disambiguation" pages are not useful here - a disambig article
  // description reads "Wikipedia disambiguation page" and its extract is
  // the disambig blurb, not the species. Drop it rather than misleading.
  if (body.type === 'disambiguation') return null
  const extract = (body.extract ?? '').trim()
  if (!extract) return null
  const pageUrl =
    body.content_urls?.desktop?.page
    ?? body.content_urls?.mobile?.page
    ?? `https://en.wikipedia.org/wiki/${slug}`
  return {
    title: body.title ?? scientificName,
    extract,
    description: body.description ?? null,
    pageUrl,
  }
}

export function useSpeciesWikipedia(scientificName: string | null | undefined) {
  return useQuery<WikipediaSummary | null>({
    queryKey: ['wikipedia', 'species-summary', scientificName ?? ''],
    queryFn: () => fetchSummary(scientificName!),
    enabled: Boolean(scientificName),
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 1,
  })
}
