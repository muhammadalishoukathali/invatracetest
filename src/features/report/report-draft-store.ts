/**
 * Report draft store. The Result screen calls `beginFromScan()` to seed a
 * draft from the last scan result; the wizard mutates it step-by-step and
 * hands it to `submitReport()` on the final step.
 */
import { create } from 'zustand'
import type {
  ExtentSize, GeoPoint, IdentifyResult, Report, ReportDraft, ReportSubmission,
} from '@/types'

type ReportStep = 'location' | 'extent' | 'consent' | 'preview'
export const REPORT_STEPS: ReportStep[] = ['location', 'extent', 'consent', 'preview']

/** Final submission state shown on the report confirmation screen. */
type ReportOutcome =
  | { kind: 'submitted'; report: Report }
  | { kind: 'queued'; queuedId: string; error: string }

interface ReportState {
  step: ReportStep
  draft: ReportDraft | null
  imageBlob: Blob | null
  imageUrl: string | null      // Object URL used to preview the scanned photo.
  submitting: boolean
  outcome: ReportOutcome | null

  beginFromScan: (args: {
    result: IdentifyResult
    imageBlob: Blob
    imageUrl: string
    observedAt: string
    captureId: string
    captureSource: 'camera' | 'gallery'
  }) => void
  goTo: (step: ReportStep) => void
  next: () => void
  back: () => void
  setLocation: (location: GeoPoint | null, accuracyM: number | null) => void
  setExtent: (extent: ExtentSize) => void
  setNotes: (notes: string) => void
  setConsent: (patch: Partial<Pick<ReportDraft, 'consentAccurate' | 'consentNoPII'>>) => void
  setSubmitting: (submitting: boolean) => void
  setOutcome: (outcome: ReportOutcome) => void
  toSubmission: () => Omit<ReportSubmission, 'photoKey'> | null
  reset: () => void
}

const createEmptyReportDraft = (
  scanResult: IdentifyResult,
  observedAt: string,
  captureId: string,
  captureSource: 'camera' | 'gallery',
): ReportDraft => ({
  photoKey: null,
  speciesId: scanResult.speciesId ?? null,
  outcome: scanResult.outcome,
  confidence: scanResult.confidence,
  modelVersion: scanResult.modelVersion,
  observedAt,
  captureId,
  captureSource,
  location: null,
  locationAccuracyM: null,
  extent: null,
  notes: '',
  consentAccurate: false,
  consentNoPII: false,
})

export const useReportDraft = create<ReportState>((set, get) => ({
  step: 'location',
  draft: null,
  imageBlob: null,
  imageUrl: null,
  submitting: false,
  outcome: null,

  beginFromScan: ({ result, imageBlob, imageUrl, observedAt, captureId, captureSource }) => set({
    step: 'location',
    draft: createEmptyReportDraft(result, observedAt, captureId, captureSource),
    imageBlob,
    imageUrl,
    submitting: false,
    outcome: null,
  }),

  goTo: (step) => set({ step }),

  next: () => {
    const currentStepIndex = REPORT_STEPS.indexOf(get().step)
    if (currentStepIndex < REPORT_STEPS.length - 1) {
      set({ step: REPORT_STEPS[currentStepIndex + 1] })
    }
  },

  back: () => {
    const currentStepIndex = REPORT_STEPS.indexOf(get().step)
    if (currentStepIndex > 0) set({ step: REPORT_STEPS[currentStepIndex - 1] })
  },

  setLocation: (location, locationAccuracyM) => {
    const draft = get().draft
    if (!draft) return
    set({ draft: { ...draft, location, locationAccuracyM } })
  },

  setExtent: (extent) => {
    const draft = get().draft
    if (!draft) return
    set({ draft: { ...draft, extent } })
  },

  setNotes: (notes) => {
    const draft = get().draft
    if (!draft) return
    set({ draft: { ...draft, notes } })
  },

  setConsent: (patch) => {
    const draft = get().draft
    if (!draft) return
    set({ draft: { ...draft, ...patch } })
  },

  setSubmitting: (submitting) => set({ submitting }),
  setOutcome: (outcome) => set({ outcome }),

  toSubmission: () => {
    const draft = get().draft
    if (!draft || !draft.location || !draft.extent) return null
    return {
      speciesId: draft.speciesId,
      outcome: draft.outcome,
      confidence: draft.confidence,
      modelVersion: draft.modelVersion,
      observedAt: draft.observedAt,
      captureId: draft.captureId,
      captureSource: draft.captureSource,
      location: draft.location,
      locationAccuracyM: draft.locationAccuracyM,
      extent: draft.extent,
      notes: draft.notes.trim(),
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
