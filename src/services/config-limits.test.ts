import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import { handlers } from '@/mocks/handlers'
import { api } from './api-client'
import type { ConfigLimits } from './config-limits'

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

describe('config limits endpoint', () => {
  it('exposes every threshold the frontend needs (AC 7.3.1)', async () => {
    const limits = await api<ConfigLimits>('/api/v1/config/limits')
    expect(limits.locationAccuracyMaxM).toBe(250)
    expect(limits.removalProximityMaxM).toBe(250)
    expect(limits.discoveryParkBufferM).toBe(1000)
    expect(limits.discoveryTrailBufferM).toBe(750)
    expect(limits.discoveryDecayScaleM).toBe(250)
    expect(limits.waterwayUpstreamMaxKm).toBe(5)
    expect(limits.occurrenceCoordUncertaintyMaxM).toBe(1000)
    expect(limits.adoptionMaxPerIdentity).toBe(50)
    expect(limits.adoptionRateLimitPerHour).toBe(30)
    expect(limits.activityChangeTolerancePct).toBe(10)
    expect(limits.removalRateLimitPerHour).toBe(20)
    expect(limits.removalRateLimitPerDay).toBe(100)
    expect(limits.removalIdempotencyWindowSeconds).toBe(60)
    expect(limits.catalogueVersion).toMatch(/^v\d{4}-\d{2}-\d{2}$/)
  })
})
