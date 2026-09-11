/** AC 5.2.4 - the two required copy strings must appear when the flags
 *  are false, and must NOT appear when they are true. The rest of the
 *  page is presentational glue; the status sections are the only
 *  load-bearing UI contract, so we test them in isolation via
 *  renderToStaticMarkup (the unit-test env has no DOM). */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  BEGINNER_SAFE_UNAVAILABLE_COPY,
  FORMAL_SEVERITY_UNAVAILABLE_COPY,
  PlantDetailStatusSections,
} from './PlantDetailPage'

describe('PlantDetailStatusSections (AC 5.2.4)', () => {
  it('renders the required copy when both flags are false', () => {
    const html = renderToStaticMarkup(
      <PlantDetailStatusSections
        formalSeverityAssessmentAvailable={false}
        beginnerSafeActionAvailable={false}
      />,
    )
    expect(html).toContain(FORMAL_SEVERITY_UNAVAILABLE_COPY)
    expect(html).toContain(BEGINNER_SAFE_UNAVAILABLE_COPY)
  })

  it('does not render the unavailable copy when both flags are true', () => {
    const html = renderToStaticMarkup(
      <PlantDetailStatusSections
        formalSeverityAssessmentAvailable={true}
        beginnerSafeActionAvailable={true}
      />,
    )
    expect(html).not.toContain(FORMAL_SEVERITY_UNAVAILABLE_COPY)
    expect(html).not.toContain(BEGINNER_SAFE_UNAVAILABLE_COPY)
  })
})
