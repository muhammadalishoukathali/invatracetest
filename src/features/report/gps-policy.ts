/**
 * Pure helpers for GPS accuracy warnings on the report location step.
 *
 * AC 7.3.1 forbids hardcoded copies of config limits in the frontend. The
 * single source of truth for the accuracy ceiling is the backend, exposed
 * to the client through `/api/v1/config/limits` and read via `useLimits()`
 * (see `src/services/config-limits.ts`). Callers pass the current threshold
 * in as an argument — no literal metre value is embedded here.
 *
 * The backend enforces the matching hard `needs_rescan` gate in
 * `backend/app/domain/validation.py`
 * (`screening_location_accuracy_max_m`). Because both sides read the same
 * config, they can no longer drift.
 */

/** True when the reported accuracy is above the configured threshold. A
 *  non-finite accuracy is treated as *not* exceeding — the location step
 *  already gates on finite accuracy separately, so this helper's job is
 *  just the numeric comparison. */
export function accuracyExceedsThreshold(
  accuracy: number | null | undefined,
  thresholdM: number,
): boolean {
  if (accuracy == null || !Number.isFinite(accuracy)) return false
  return accuracy > thresholdM
}

/** Copy for the soft-warning banner on the report location step. Kept
 *  aligned with the server's `location_accuracy_insufficient` reason so a
 *  user who submits anyway sees the same explanation on both sides of the
 *  screening handoff. The threshold is interpolated at call time. */
export function formatAccuracyMessage(
  accuracy: number | null | undefined,
  thresholdM: number,
): string {
  const suffix = accuracy != null && Number.isFinite(accuracy)
    ? ` Reported accuracy is about ${Math.round(accuracy)} m.`
    : ''
  return (
    `Reported accuracy is above ${thresholdM} m. You can still submit, ` +
    `but a fresh fix in an open area will give reviewers a more useful location.${suffix}`
  )
}

/** The reason-code copy shown on the report tracking page when a submission
 *  is bounced back for accuracy. Deliberately does not embed a literal metre
 *  value — the numeric threshold lives in server config only, and the user
 *  gets the exact number from the accompanying warning on the report step
 *  before they submit. */
export const LOCATION_ACCURACY_INSUFFICIENT_MESSAGE =
  'Location accuracy did not meet the required threshold for automated screening.'
