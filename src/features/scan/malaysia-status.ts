import type { IdentifyResult, MalaysiaStatusState } from '@/types'

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
  return 'status_uncertain'
}

export function isReportEligible(state: MalaysiaStatusState | null): boolean {
  return state === 'invasive'
}
