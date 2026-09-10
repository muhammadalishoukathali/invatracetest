import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import { handlers } from '@/mocks/handlers'
import { api } from './api-client'
import type { CatalogueDetail, CatalogueListResponse } from './catalogue'

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

describe('catalogue endpoint (AC 5.2.1 - 5.2.6)', () => {
  it('exposes catalogueVersion + reviewedAt alongside the species list', async () => {
    const body = await api<CatalogueListResponse>('/api/v1/catalogue')
    expect(body.catalogueVersion).toBe('v2026-09-08')
    expect(body.reviewedAt).toBe('2026-09-08')
    expect(body.totalSpeciesCount).toBe(32)
    expect(Array.isArray(body.items)).toBe(true)
  })

  it('search returns matches for a scientific-name substring', async () => {
    const body = await api<CatalogueListResponse>('/api/v1/catalogue/search?q=mikania')
    expect(body.items).toHaveLength(1)
    expect(body.items[0].scientificName).toBe('Mikania micrantha')
  })

  it('detail deep-links to the same species record', async () => {
    const body = await api<CatalogueDetail>('/api/v1/catalogue/mikania-micrantha')
    expect(body.speciesId).toBe('mikania-micrantha')
    // AC 5.2.4 - severity/formal-assessment fields exist and default to false
    // when no reviewed record is present. UI must not invent severity.
    expect(body.formalSeverityAssessmentAvailable).toBe(false)
    expect(body.beginnerSafeActionAvailable).toBe(false)
  })
})
