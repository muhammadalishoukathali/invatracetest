/**
 * Persists the user's own permission/safety choice for a given scan or map
 * sighting ("protected land or unsure" vs "I have the land manager's
 * permission") in localStorage, keyed by a scan/sighting id. This is
 * deliberately separate from scan-history-store.ts: it's not a record of
 * what was scanned, it's a private safety note the device remembers so
 * PlantGuidancePanel doesn't ask the same question again if the user comes
 * back to the same result. It never changes official land status — see the
 * `decisionContext` doc comment on PlantGuidancePanel's props.
 */
export type GuidanceDecisionChoice = 'protected_or_unsure' | 'manager_permission'

export interface GuidanceDecision {
  contextId: string
  choice: GuidanceDecisionChoice
  plantId: string | null
  recordedAt: string
}

interface StoredGuidanceDecisions {
  version: 1
  decisions: Record<string, GuidanceDecision>
}

interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem?: (key: string) => void
}

const STORAGE_ENTRY = 'invatrace-guidance-decisions-v1'
const MAX_SAVED_DECISIONS = 100

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function emptyStore(): StoredGuidanceDecisions {
  return { version: 1, decisions: {} }
}

function readStore(storage: StorageLike | null): StoredGuidanceDecisions {
  if (!storage) return emptyStore()
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_ENTRY) ?? '') as Partial<StoredGuidanceDecisions>
    if (parsed.version !== 1 || !parsed.decisions || typeof parsed.decisions !== 'object') return emptyStore()
    const decisions = Object.fromEntries(
      Object.entries(parsed.decisions).filter((entry): entry is [string, GuidanceDecision] => {
        const [contextId, decision] = entry
        if (!decision || typeof decision !== 'object') return false
        return decision.contextId === contextId
          && (decision.choice === 'protected_or_unsure' || decision.choice === 'manager_permission')
          && typeof decision.recordedAt === 'string'
          && (decision.plantId === null || typeof decision.plantId === 'string')
      }),
    )
    return { version: 1, decisions }
  } catch {
    return emptyStore()
  }
}

export function getGuidanceDecision(
  contextId: string,
  storage: StorageLike | null = browserStorage(),
): GuidanceDecision | null {
  const decision = readStore(storage).decisions[contextId]
  if (!decision) return null
  if (decision.choice !== 'protected_or_unsure' && decision.choice !== 'manager_permission') return null
  return decision
}

export function saveGuidanceDecision(
  input: Omit<GuidanceDecision, 'recordedAt'> & { recordedAt?: string },
  storage: StorageLike | null = browserStorage(),
): GuidanceDecision | null {
  if (!storage) return null
  const decision: GuidanceDecision = {
    contextId: input.contextId,
    choice: input.choice,
    plantId: input.plantId,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  }
  const current = readStore(storage)
  const decisions = { ...current.decisions, [decision.contextId]: decision }
  const newest = Object.values(decisions)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    .slice(0, MAX_SAVED_DECISIONS)
  try {
    storage.setItem(STORAGE_ENTRY, JSON.stringify({
      version: 1,
      decisions: Object.fromEntries(newest.map((item) => [item.contextId, item])),
    } satisfies StoredGuidanceDecisions))
    return decision
  } catch {
    return null
  }
}

export function clearGuidanceDecisions(
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    storage?.removeItem?.(STORAGE_ENTRY)
  } catch {
    // Storage may become unavailable after the page has loaded.
  }
}
