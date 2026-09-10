import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import { handlers } from '@/mocks/handlers'
import { ApiError } from '@/services/api-client'
import {
  isRemovalError,
  newIdempotencyKey,
  submitRemovalReport,
} from './removal-report'

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

const REPORT_ID = '00000000-0000-4000-8000-000000000001'

describe('removal-report endpoint (AC 4.2.1 - 4.2.4)', () => {
  it('resolves to removal_reported when accuracy and proximity are satisfied', async () => {
    const body = await submitRemovalReport(
      REPORT_ID,
      { latitude: 3.1500, longitude: 101.6900, accuracyM: 12 },
      newIdempotencyKey(),
    )
    expect(body.toStatus).toBe('removal_reported')
    expect(body.reportId).toBe(REPORT_ID)
    expect(body.calculatedDistanceM).toBeLessThanOrEqual(body.proximityMaxM)
    // AC 7.3.1 - thresholds surfaced by the server so the UI never hardcodes.
    expect(body.accuracyCeilingM).toBe(250)
    expect(body.proximityMaxM).toBe(250)
  })

  it('rejects an accuracy fix worse than the server ceiling with LOCATION_INACCURATE', async () => {
    // AC 4.2.2 - accuracy > ceiling must never satisfy the vicinity check.
    await expect(
      submitRemovalReport(
        REPORT_ID,
        { latitude: 3.1500, longitude: 101.6900, accuracyM: 400 },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject({ code: 'LOCATION_INACCURATE' })
  })

  it('rejects a submission from beyond the proximity radius with LOCATION_OUT_OF_RANGE', async () => {
    // AC 4.2.3 - > proximity_max_m must yield LOCATION_OUT_OF_RANGE, not a
    // generic 422. The client copy switches on the code.
    let caught: unknown = null
    try {
      await submitRemovalReport(
        REPORT_ID,
        { latitude: 3.2000, longitude: 101.7500, accuracyM: 10 },
        newIdempotencyKey(),
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect(isRemovalError(caught)).toBe(true)
    if (isRemovalError(caught)) {
      expect(caught.code).toBe('LOCATION_OUT_OF_RANGE')
    }
  })

  it('rejects a removal against a sighting that is no longer eligible', async () => {
    // AC 4.2.1 - a sighting already in removal_reported must not accept
    // another removal (mock keys off the `-removed` suffix).
    const doneReportId = '00000000-0000-4000-8000-000000000-removed'
    await expect(
      submitRemovalReport(
        doneReportId,
        { latitude: 3.1500, longitude: 101.6900, accuracyM: 15 },
        newIdempotencyKey(),
      ),
    ).rejects.toMatchObject({ code: 'SIGHTING_NOT_ELIGIBLE' })
  })

  it('rejects a request without a valid Idempotency-Key', async () => {
    // AC 4.2.5 - malformed keys must fall through to a 400 so the offline
    // retry queue never persists garbage identifiers as legitimate submissions.
    await expect(
      submitRemovalReport(
        REPORT_ID,
        { latitude: 3.1500, longitude: 101.6900, accuracyM: 15 },
        'short',
      ),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('generates idempotency keys that match the server pattern', () => {
    const pattern = /^[A-Za-z0-9._:-]{8,128}$/
    for (let i = 0; i < 10; i++) {
      expect(newIdempotencyKey()).toMatch(pattern)
    }
  })
})
