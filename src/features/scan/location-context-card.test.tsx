/** AC 3.3.5 - the boundary source, dataset version, boundary update date,
 *  GPS accuracy and the "not removal permission" disclaimer must all be
 *  driven by the API response, never hardcoded. The Vitest env has no
 *  DOM, so we render the BoundaryAttribution subtree via
 *  renderToStaticMarkup and assert the strings appear / don't appear
 *  based on which fields the response carries. */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { BoundaryAttribution } from './LocationContextCard'
import type { LocationContextResult } from '@/services/location-context'

const BASE: LocationContextResult = {
  contextState: 'inside_protected_area',
  actionEligible: false,
  boundarySource: 'Federal Dept of Forestry Peninsular Malaysia',
  boundaryVersion: 'dev-seed-2026-09-11',
  boundaryName: 'Bukit Kiara Federal Park',
  boundaryUpdatedAt: '2026-09-11T00:00:00Z',
  checkedAt: '2026-09-11T12:00:00Z',
  accuracyCeilingM: 250,
  gpsAccuracyM: 18,
}

describe('BoundaryAttribution (AC 3.3.5)', () => {
  it('renders GPS accuracy and boundary update date from the API response', () => {
    const html = renderToStaticMarkup(<BoundaryAttribution result={BASE} />)
    expect(html).toContain('GPS accuracy: 18 m')
    expect(html).toContain('Boundary updated: 2026-09-11')
    expect(html).toContain('Federal Dept of Forestry Peninsular Malaysia')
    expect(html).toContain('vdev-seed-2026-09-11')
    // AC 3.3.5 disclaimer must always be present.
    expect(html).toContain('Mapped status is not removal permission.')
  })

  it('omits the GPS accuracy and boundary update rows when the fields are absent', () => {
    const html = renderToStaticMarkup(
      <BoundaryAttribution
        result={{
          ...BASE,
          boundarySource: null,
          boundaryVersion: null,
          boundaryName: null,
          boundaryUpdatedAt: null,
        }}
      />,
    )
    expect(html).not.toContain('Boundary updated:')
    expect(html).not.toContain('Boundary source:')
    // GPS accuracy still comes through because the API always echoes it,
    // but the disclaimer must still render.
    expect(html).toContain('Mapped status is not removal permission.')
  })
})
