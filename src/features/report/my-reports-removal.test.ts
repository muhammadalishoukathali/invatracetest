import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// AC 4.5.1 - the "Mark as removed" control must not be displayed for a
// deleted, rejected or already removal_reported sighting. On the report
// object, only 'screened' backs a live, still-eligible sighting; 'merged'
// is blocked server-side (removals.py:_BLOCKED_STATUSES), so treat it as
// blocked on the frontend too. These are source-text asserts to match the
// existing test style in this feature (no jsdom / testing-library wired in).

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(resolve(HERE, 'MyReportsPage.tsx'), 'utf8')

describe('MyReportsPage removal control gating (AC 4.5.1)', () => {
  it('gates on a strict allow-list of report.status', () => {
    expect(SOURCE).toContain("report.status === 'screened'")
  })

  it('does not enable the control for merged reports', () => {
    // The previous mismatch was `report.status === 'merged'` re-enabling the
    // button here even though the backend blocks merged with 422.
    expect(SOURCE).not.toContain("report.status === 'merged'")
  })

  it('still requires a sightingId before offering removal', () => {
    expect(SOURCE).toContain('report.sightingId != null')
  })

  it('renders the "Mark as removed" button only when canReportRemoval is true', () => {
    expect(SOURCE).toContain('{canReportRemoval && !removalOpen && (')
    expect(SOURCE).toContain('Mark as removed')
  })
})
