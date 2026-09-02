import type { IdentifyResult, MalaysiaStatusState } from '@/types'

/**
 * Maps the raw malaysiaStatus string the model/catalog attaches to a scan
 * result down to the three states the UI actually branches on: invasive
 * (reportable), information_only (identified but not part of the pilot's
 * report-eligible list), or status_uncertain (we don't trust the status
 * enough to let it drive a report). The current pilot scope is Malaysia
 * only, per docs/product.md, so this file has no notion of any other
 * jurisdiction's rules.
 */
const STATUS_UNCERTAIN_VALUES = new Set([
  'status_requires_expert_review',
  'cryptogenic_uncertain',
  'watchlist_not_present',
])

const INFORMATION_ONLY_VALUES = new Set([
  'alien_not_marked_invasive',
  'common_cultivated_status_not_inferred',
  'introduced',
  'native',
  'naturalised',
])

export function deriveMalaysiaStatusState(result: IdentifyResult): MalaysiaStatusState | null {
  if (result.outcome === 'uncertain') return null
  const raw = result.malaysiaStatus
  if (!raw) return 'status_uncertain'
  if (raw === 'invasive') return 'invasive'
  if (STATUS_UNCERTAIN_VALUES.has(raw)) return 'status_uncertain'
  if (INFORMATION_ONLY_VALUES.has(raw)) return 'information_only'
  // Any status value we don't explicitly recognise falls back to uncertain
  // rather than being treated as safe-to-report — a new/unmapped status code
  // from the catalog should never silently unlock reporting.
  return 'status_uncertain'
}

export function isReportEligible(state: MalaysiaStatusState | null): boolean {
  return state === 'invasive'
}
