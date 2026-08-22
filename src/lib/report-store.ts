/**
 * Report draft store. The Result screen calls `beginFromScan()` to seed a
 * draft from the last scan result; the wizard mutates it step-by-step and
 * hands it to `submitReport()` on the final step.
 */
import { create } from 'zustand'
import type {
  ExtentSize, GeoPoint, IdentifyResult, Report, ReportDraft, ReportSubmission,
} from '@/types'

export type ReportStep = 'location' | 'extent' | 'consent' | 'preview'
export const REPORT_STEPS: ReportStep[] = ['location', 'extent', 'consent', 'preview']

/** Submission outcome surfaced to the confirmation screen. */
export type ReportOutcome =
  | { kind: 'submitted'; report: Report }
  | { kind: 'queued'; queuedId: string; error: string }

interface ReportState {
  step: ReportStep
  draft: ReportDraft | null
  imageBlob: Blob | null
  imageUrl: string | null      // preview URL — copy of the scan's blob URL
  submitting: boolean
  outcome: ReportOutcome | null

  beginFromScan: (args: {
    result: IdentifyResult
    imageBlob: Blob
    imageUrl: string
  }) => void
  goTo: (step: ReportStep) => void
  next: () => void
  back: () => void
  setLocation: (loc: GeoPoint | null, accuracyM: number | null) => void
  setExtent: (extent: ExtentSize) => void
  setNotes: (notes: string) => void
  setConsent: (patch: Partial<Pick<ReportDraft, 'consentAccurate' | 'consentNoPII'>>) => void
  setSubmitting: (v: boolean) => void
  setOutcome: (o: ReportOutcome) => void
  toSubmission: () => Omit<ReportSubmission, 'photoKey'> | null
  reset: () => void
}

const EMPTY_DRAFT = (r: IdentifyResult): ReportDraft => ({
  photoKey: null,
  speciesId: r.speciesId ?? null,
  outcome: r.outcome,
  confidence: r.confidence,
  modelVersion: r.modelVersion,
  location: null,
  locationAccuracyM: null,
  extent: 'small_patch',
  notes: '',
  consentAccurate: false,
  consentNoPII: false,
})

export const useReport = create<ReportState>((set, get) => ({
  step: 'location',
  draft: null,
  imageBlob: null,
  imageUrl: null,
  submitting: false,
  outcome: null,

  beginFromScan: ({ result, imageBlob, imageUrl }) => set({
    step: 'location',
    draft: EMPTY_DRAFT(result),
    imageBlob,
    imageUrl,
    submitting: false,
    outcome: null,
  }),

  goTo: (step) => set({ step }),

  next: () => {
    const i = REPORT_STEPS.indexOf(get().step)
    if (i < REPORT_STEPS.length - 1) set({ step: REPORT_STEPS[i + 1] })
  },

  back: () => {
    const i = REPORT_STEPS.indexOf(get().step)
    if (i > 0) set({ step: REPORT_STEPS[i - 1] })
  },

  setLocation: (location, locationAccuracyM) => {
    const d = get().draft
    if (!d) return
    set({ draft: { ...d, location, locationAccuracyM } })
  },

  setExtent: (extent) => {
    const d = get().draft
    if (!d) return
    set({ draft: { ...d, extent } })
  },

  setNotes: (notes) => {
    const d = get().draft
    if (!d) return
    set({ draft: { ...d, notes } })
  },

  setConsent: (patch) => {
    const d = get().draft
    if (!d) return
    set({ draft: { ...d, ...patch } })
  },

  setSubmitting: (v) => set({ submitting: v }),
  setOutcome: (outcome) => set({ outcome }),

  toSubmission: () => {
    const d = get().draft
    if (!d || !d.location) return null
    return {
      speciesId: d.speciesId,
      outcome: d.outcome,
      confidence: d.confidence,
      modelVersion: d.modelVersion,
      location: d.location,
      locationAccuracyM: d.locationAccuracyM,
      extent: d.extent,
      notes: d.notes.trim(),
      consent: { accurate: true, noPII: true },
    }
  },

  reset: () => set({
    step: 'location',
    draft: null,
    imageBlob: null,
    imageUrl: null,
    submitting: false,
    outcome: null,
  }),
}))
