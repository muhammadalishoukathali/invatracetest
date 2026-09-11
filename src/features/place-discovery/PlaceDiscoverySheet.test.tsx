/** Wave 2c — PlaceDiscoverySheet content tests. The sheet body is
 *  extracted as a pure component so we can render it via SSR without
 *  spinning up MSW or the QueryClient. Error/loading states go through
 *  the parent shell, so we test their copy constants directly. */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

import {
  DataVersionFooter,
  EMPTY_STATE_COPY,
  ERROR_STATE_COPY,
  PlaceSheetBody,
} from './PlaceDiscoverySheet'

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
}

describe('PlaceDiscoverySheet', () => {
  it('renders the empty-state copy when the association list is empty', () => {
    const html = render(
      <PlaceSheetBody associations={[]} placeId="bukit-kiara-park" />,
    )
    expect(html).toContain(EMPTY_STATE_COPY)
  })

  it('exposes the error-state copy constant for the shell to render', () => {
    // The shell wraps this string in role="alert"; the constant is the
    // load-bearing part of the contract.
    expect(ERROR_STATE_COPY).toBe(
      'Could not load recorded plants. Try again in a moment.',
    )
  })

  it('omits the data-version footer entirely when both fields are missing', () => {
    const html = renderToStaticMarkup(<DataVersionFooter />)
    expect(html).toBe('')
  })

  it('renders the data-version footer when at least one field is present', () => {
    const html = renderToStaticMarkup(
      <DataVersionFooter processedDataVersion="proc-2026-09-10" />,
    )
    expect(html).toContain('proc-2026-09-10')
  })
})
