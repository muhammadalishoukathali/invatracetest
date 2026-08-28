/** Arch §8.1 — role is what a person may do. Trust level is what their evidence
 *  is worth, and is deliberately a separate attribute. */
export type Role = 'Detector' | 'Volunteer' | 'Coordinator' | 'Expert' | 'Admin'
export type TrustLevel = 'New' | 'Trusted' | 'Steward'

/** Server-authoritative profile attached to one pseudonymous installation. */
export interface PseudonymousProfile {
  id: string
  displayName: string | null
  role: Role
  trustLevel: TrustLevel
}

/** Long-lived local identity. This is the only identity record stored by the client. */
export interface AnonymousIdentity {
  schemaVersion: 2
  installationToken: string
  createdAt: string
  profileId: string | null
  recoverySetupComplete: boolean
}

export interface StartPrivateAccessResponse {
  accessToken: string
  profile: PseudonymousProfile
  recoveryCodes: string[]
  installationId: string
}

export interface BootstrapSessionResponse {
  accessToken: string
  profile: PseudonymousProfile
  recoverySetupRequired: boolean
}

export interface RestorePrivateAccessResponse {
  accessToken: string
  profile: PseudonymousProfile
  installationId: string
}

export interface RecoveryCodeBatchResponse {
  recoveryCodes: string[]
  createdAt: string
}

export interface AuthorizedInstallation {
  id: string
  createdAt: string
  lastUsedAt: string
  revokedAt: string | null
  current: boolean
}

export interface AccessOverview {
  profileId: string
  unusedRecoveryCodeCount: number
  installations: AuthorizedInstallation[]
}

/** Arch §8.2 — the lifecycle spine. Only `confirmed` may trigger action. */
export type SightingStatus = 'candidate' | 'confirmed' | 'rejected' | 'removed'
export type Risk = 'high' | 'watch'

/* ── Scan & species ─────────────────────────────────────── */

export type Outcome = 'target' | 'other_plant' | 'uncertain'

export interface BBox { x: number; y: number; w: number; h: number }

export interface QualityResult { ok: boolean; reason?: string }

export interface DetectResult { box: BBox | null }

export interface IdentifyResult {
  outcome: Outcome
  speciesId?: string
  confidence: number
  modelVersion: string
}

export interface Trait { label: string; value: string }

export interface NativeTwin {
  id: string
  name: string
  latinName: string
  distinguishingTraits: string[]
}

export interface RemovalStep { order: number; action: string; safe: boolean }

export interface SpeciesDetail {
  id: string
  name: string
  latinName: string
  commonNames: string[]
  isInvasive: boolean
  risk: Risk
  traits: Trait[]
  nativeTwin: NativeTwin | null
  removalSteps: RemovalStep[]
  doNotDo: string[]
}

/* ── Report ─────────────────────────────────────────────── */

export type ExtentSize = 'single' | 'small_patch' | 'large_area'

export interface GeoPoint { lat: number; lng: number }

export interface PresignedUpload {
  uploadId: string
  uploadUrl: string   // where the client PUTs the image blob
  photoKey: string    // opaque key echoed back on report create
  expiresAt: string   // ISO
}

/** What the client builds locally before submitting. */
export interface ReportDraft {
  photoKey: string | null           // set after presigned upload succeeds
  speciesId: string | null          // may be null when outcome === 'uncertain'
  outcome: Outcome
  confidence: number
  modelVersion: string
  location: GeoPoint | null
  locationAccuracyM: number | null  // GPS accuracy in metres; null = manual
  extent: ExtentSize
  notes: string
  consentAccurate: boolean
  consentNoPII: boolean
}

/** The submission wire format. */
export interface ReportSubmission {
  photoKey: string
  speciesId: string | null
  outcome: Outcome
  confidence: number
  modelVersion: string
  location: GeoPoint
  locationAccuracyM: number | null
  extent: ExtentSize
  notes: string
  consent: { accurate: true; noPII: true }
}

export interface Report {
  id: string
  status: SightingStatus
  createdAt: string
  submission: ReportSubmission
  trackingUrl: string
}

/** Item held in the IndexedDB offline queue when submission fails. */
export interface QueuedReport {
  id: string           // local uuid
  createdAt: string
  attempts: number
  lastError: string | null
  submission: ReportSubmission
  imageBlob: Blob      // image kept locally until presign + upload succeed
}

/* ── Map ────────────────────────────────────────────────── */

/** Map pin returned by GET /api/v1/sightings. Coordinates have already had
 *  the §11 precision policy applied server-side. `precisionReduced` tells
 *  the client to show a "location approximate" note in the pin sheet. */
export interface Sighting {
  id: string
  speciesId: string
  speciesName: string
  latinName: string
  status: SightingStatus
  risk: Risk
  location: GeoPoint
  precisionReduced: boolean
  reportCount: number
  lastReportedAt: string
}

export interface SightingDetail extends Sighting {
  recommendedAction: string
  reporterTrust: TrustLevel  // 'New' means precision policy hides exact spot
}

/* ── Verify queue ───────────────────────────────────────── */

export type VerifyOutcome = 'confirm' | 'reject' | 'merge'
export type CheckLevel = 'pass' | 'warn' | 'fail'

export interface VerifyCheck {
  id: 'species' | 'location' | 'quality' | 'trust'
  label: string
  level: CheckLevel
  detail: string
}

/** One row in the coordinator's queue. Enriched candidate report. */
export interface VerifyItem {
  id: string                     // report id
  photoUrl: string               // presigned read URL (mocked)
  speciesId: string | null
  speciesName: string
  latinName: string
  outcome: Outcome               // model verdict at scan time
  confidence: number
  modelVersion: string
  location: GeoPoint
  locationAccuracyM: number | null
  /** Human-readable Malaysian place label — e.g. "Bukit Kiara · West Trail".
   *  Mock reverse-geocode in Iter 1; real backend will use MapTiler / OSM
   *  Nominatim with a Malaysia-scoped bias. */
  place: string
  extent: ExtentSize
  notes: string
  submitterId: string
  submitterTrust: TrustLevel
  submittedAt: string
  checks: VerifyCheck[]
}

/** Existing sighting the coordinator could merge this report into. */
export interface MergeCandidate {
  id: string
  speciesName: string
  status: SightingStatus
  distanceM: number
  reportCount: number
  lastReportedAt: string
}

/* ── Notifications ──────────────────────────────────────── */

export type NotificationKind =
  | 'report_confirmed'   // your report was verified
  | 'report_rejected'    // your report was rejected
  | 'queue_new'          // coordinator: new item in verify queue
  | 'sync_ok'            // offline queue flushed successfully
  | 'system'             // generic

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  body: string
  createdAt: string
  read: boolean
  linkTo?: string        // in-app route to open on click
}
