/** Wave 2c — PlantAssociationCard unit tests. Rendered through
 *  react-dom/server since the vitest env is Node with no jsdom. */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

import { PlantAssociationCard } from './PlantAssociationCard'
import type { PlantAssociation } from '@/services/place-discovery'

function render(item: PlantAssociation): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <PlantAssociationCard item={item} />
    </MemoryRouter>,
  )
}

const baseItem: PlantAssociation = {
  speciesId: 'mikania-micrantha',
  scientificName: 'Mikania micrantha',
  commonNames: ['Mile-a-minute'],
  catalogueLink: '/plants/mikania-micrantha',
  evidenceCodes: ['G'],
  malaysianStates: ['Selangor'],
  evidence: [],
  totalScore: 1.0,
  qualifyingRecords: 2,
  mostRecentYear: 2025,
  closestDistanceM: 0,
  insideArea: false,
  directionAwareEvidence: false,
}

describe('PlantAssociationCard', () => {
  it('renders scientific name italicised', () => {
    const html = render(baseItem)
    expect(html).toMatch(/font-style:italic[^>]*>Mikania micrantha/)
  })

  it('shows "Inside this area" when evidence type is inside', () => {
    const html = render({
      ...baseItem,
      evidenceRecords: [{ type: 'inside', distanceM: 0 }],
    })
    expect(html).toContain('Inside this area')
  })

  it('shows the upstream waterway chip with network distance when present', () => {
    const html = render({
      ...baseItem,
      evidenceRecords: [
        { type: 'upstream_waterway', distanceM: 300, networkDistanceM: 420 },
      ],
    })
    expect(html).toContain('Upstream waterway record')
    expect(html).toContain('420 m along network')
  })

  it('exposes rank_components.tier via data-tier', () => {
    const html = render({
      ...baseItem,
      rankComponents: { tier: 2, nearbyComponent: 0.6, upstreamComponent: 0.1 },
    })
    expect(html).toContain('data-tier="2"')
    expect(html).toContain('data-nearby-component="0.6"')
    expect(html).toContain('data-upstream-component="0.1"')
  })
})
