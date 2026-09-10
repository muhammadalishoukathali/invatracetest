/** Iteration 2 Phase 7 - Epic 6 post-report adopt prompt (AC 6.1.2).
 *
 *  Rendered inside ReportSubmissionResult when a submitted report
 *  produced a Sighting that fell inside a MonitoredArea polygon
 *  (i.e. sighting.place.areaId is present). Wires the "Adopt this
 *  area" affordance so a fresh reporter can track ongoing activity
 *  without having to leave the result screen. On success we surface a
 *  quiet confirmation and hide the button - navigating to /areas
 *  is left to the user's next action so this stays a prompt, not a
 *  hijack of the report submission flow.
 *
 *  Every failure mode gets an honest message pulled from the server
 *  problem code:
 *    - ADOPTION_LIMIT_REACHED  -> "You have hit the adopted-area cap"
 *    - RATE_LIMITED            -> "Wait a moment before adopting more"
 *    - anything else           -> generic "Could not adopt"
 *  The button never claims success it did not get.
 */
import { useState } from 'react'
import { adoptArea } from '@/services/adopted-areas'
import { ApiError } from '@/services/api-client'


export function AdoptAreaPrompt({
  areaId,
  areaName,
}: {
  areaId: string
  areaName: string | null
}) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'adopted'; placeName: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const handleAdopt = async () => {
    setState({ kind: 'pending' })
    try {
      const created = await adoptArea(areaId)
      setState({ kind: 'adopted', placeName: created.placeName })
    } catch (err) {
      let message = 'Could not adopt this area right now. Try again later.'
      if (err instanceof ApiError) {
        if (err.code === 'ADOPTION_LIMIT_REACHED') {
          message = 'You have reached the adopted-area limit. Remove one from your dashboard before adopting another.'
        } else if (err.code === 'rate_limited') {
          message = 'You are adopting areas too quickly. Please wait a moment.'
        }
      }
      setState({ kind: 'error', message })
    }
  }

  if (state.kind === 'adopted') {
    return (
      <div className="adopt-area-prompt adopt-area-prompt--success" role="status">
        <strong>{state.placeName}</strong> is now in your adopted areas.
      </div>
    )
  }

  return (
    <aside className="adopt-area-prompt" aria-live="polite">
      <h2>Track this area</h2>
      <p>
        Adopt {areaName ?? 'this area'} to see the community's monitoring
        activity here in the coming weeks.
      </p>
      <button
        type="button"
        className="adopt-area-prompt__button"
        onClick={handleAdopt}
        disabled={state.kind === 'pending'}
      >
        {state.kind === 'pending' ? 'Adopting…' : 'Adopt this area'}
      </button>
      {state.kind === 'error' && (
        <p className="adopt-area-prompt__error" role="alert">{state.message}</p>
      )}
    </aside>
  )
}
