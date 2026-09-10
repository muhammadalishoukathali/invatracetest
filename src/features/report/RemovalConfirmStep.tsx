/** Iteration 2 Phase 4 - Epic 4 removal-report confirmation UI.
 *
 *  Renders inside a modal launched from ``SightingDetailsSheet`` when a
 *  finder is standing at their own reported plant and wants to mark it
 *  removed. Server is authoritative on the accuracy ceiling and vicinity
 *  radius (surfaced via useLimits()); this component:
 *
 *    1. Requests a fresh geolocation fix (never cached).
 *    2. Blocks Submit until accuracy is known and no worse than the ceiling.
 *    3. Sends the removal-report with a fresh UUIDv4 Idempotency-Key.
 *    4. Maps server error codes to actionable copy.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { Icon } from '@/components/Icon'
import { ApiError } from '@/services/api-client'
import { useLimits } from '@/services/config-limits'
import {
  isRemovalError,
  newIdempotencyKey,
  submitRemovalReport,
  type RemovalErrorCode,
  type RemovalReportResult,
} from '@/services/removal-report'

type Step =
  | 'idle'
  | 'permission_denied'
  | 'awaiting_fix'
  | 'ready_to_submit'
  | 'submitting'
  | 'success'
  | 'failed'

interface Props {
  reportId: string
  onDone?: (result: RemovalReportResult) => void
  onCancel?: () => void
}

interface LocationFix {
  latitude: number
  longitude: number
  accuracyM: number
  capturedAt: string
}

const SERVER_COPY: Record<RemovalErrorCode, string> = {
  LOCATION_UNAVAILABLE:
    'The location check could not run. Try again once you have a location fix.',
  LOCATION_INACCURATE:
    'Your location accuracy is worse than the required ceiling. Move to open sky and re-check.',
  LOCATION_OUT_OF_RANGE:
    'You appear to be outside the required distance from the sighting. Move closer and re-check.',
  LOCATION_PERMISSION_DENIED:
    'Location permission was denied. Grant location access to confirm a removal.',
  RATE_LIMITED:
    'Too many removal reports from this profile recently. Please wait and try again later.',
  SIGHTING_NOT_ELIGIBLE:
    'This sighting is no longer eligible to receive a removal report.',
  SIGHTING_NOT_FOUND:
    'The sighting for this report could not be found.',
}

export function RemovalConfirmStep({ reportId, onDone, onCancel }: Props) {
  const { data: limits } = useLimits()
  const [step, setStep] = useState<Step>('idle')
  const [fix, setFix] = useState<LocationFix | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [result, setResult] = useState<RemovalReportResult | null>(null)
  // A fresh key per submit attempt: two clicks on Submit should not replay
  // the earlier response - retries on transient network errors reuse the same
  // key so the server can dedupe them.
  const idempotencyKey = useRef<string>(newIdempotencyKey())

  const requestFix = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStep('failed')
      setErrorText('Location services are not available on this device.')
      return
    }
    setStep('awaiting_fix')
    setErrorText(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFix({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: position.coords.accuracy,
          capturedAt: new Date().toISOString(),
        })
        setStep('ready_to_submit')
      },
      (err) => {
        if (err.code === 1) {
          setStep('permission_denied')
        } else {
          setStep('failed')
          setErrorText('The location check could not complete. Try again in a moment.')
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
  }, [])

  useEffect(() => {
    void requestFix()
  }, [requestFix])

  const submit = useCallback(async () => {
    if (!fix) return
    setStep('submitting')
    setErrorText(null)
    try {
      const body = await submitRemovalReport(
        reportId,
        {
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracyM: fix.accuracyM,
        },
        idempotencyKey.current,
      )
      setResult(body)
      setStep('success')
      onDone?.(body)
    } catch (err: unknown) {
      if (isRemovalError(err)) {
        setErrorText(SERVER_COPY[err.code])
      } else if (err instanceof ApiError) {
        setErrorText(err.message || 'Submission failed.')
      } else {
        setErrorText('Network error - the removal report was not recorded.')
      }
      // Mint a new key so a follow-up submit with a different fix is not
      // dedup'd against the failed attempt on the server.
      idempotencyKey.current = newIdempotencyKey()
      setStep('failed')
    }
  }, [fix, onDone, reportId])

  const accuracyCeiling = limits?.locationAccuracyMaxM ?? null
  const proximityMax = limits?.removalProximityMaxM ?? null
  const accuracyOverCeiling =
    fix && accuracyCeiling !== null && fix.accuracyM > accuracyCeiling

  return (
    <section
      aria-live="polite"
      aria-labelledby="removal-confirm-heading"
      style={{
        padding: 16,
        borderRadius: 'var(--r-card)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <h2 id="removal-confirm-heading" style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
        Confirm removal at this location
      </h2>
      <p style={{ marginTop: 6, marginBottom: 0, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
        Before submitting, we need a fresh location fix so we can confirm you
        are standing at the reported plant.
        {proximityMax !== null && (
          <> Within <strong>{proximityMax} m</strong> of the sighting is required.</>
        )}
        {accuracyCeiling !== null && (
          <> Location accuracy must be <strong>{accuracyCeiling} m</strong> or better.</>
        )}
      </p>

      {step === 'awaiting_fix' && (
        <StatusRow icon="MapPin" text="Getting a fresh location fix..." busy />
      )}

      {step === 'permission_denied' && (
        <StatusRow
          icon="MapPin"
          tone="warn"
          text="Location permission is required to confirm a removal. Grant access and try again."
          actionLabel="Re-request location"
          onAction={requestFix}
        />
      )}

      {fix && (step === 'ready_to_submit' || step === 'submitting' || step === 'failed') && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--body)' }}>
          <div>Location captured {new Date(fix.capturedAt).toLocaleTimeString()}.</div>
          <div>
            Reported accuracy: <strong>{Math.round(fix.accuracyM)} m</strong>
            {accuracyOverCeiling && (
              <span style={{ color: 'var(--red)' }}>
                {' '}(worse than the {accuracyCeiling} m ceiling)
              </span>
            )}
          </div>
        </div>
      )}

      {errorText && (
        <StatusRow icon="AlertTriangle" tone="danger" text={errorText} />
      )}

      {step === 'success' && result && (
        <StatusRow
          icon="Check"
          tone="ok"
          text={`Removal recorded (${result.calculatedDistanceM.toFixed(0)} m from the sighting).`}
        />
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '8px 14px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-chip)',
            background: 'transparent',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {step === 'success' ? 'Close' : 'Cancel'}
        </button>
        {step !== 'success' && (
          <button
            type="button"
            onClick={submit}
            disabled={
              !fix
              || step === 'submitting'
              || step === 'awaiting_fix'
              || accuracyOverCeiling === true
            }
            style={{
              padding: '8px 14px',
              border: 'none',
              borderRadius: 'var(--r-chip)',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              fontSize: 13,
              fontWeight: 600,
              cursor: !fix || accuracyOverCeiling ? 'not-allowed' : 'pointer',
              opacity: !fix || accuracyOverCeiling || step === 'submitting' ? 0.5 : 1,
            }}
          >
            {step === 'submitting' ? 'Submitting...' : 'Mark as removed'}
          </button>
        )}
      </div>
    </section>
  )
}

interface StatusRowProps {
  icon: string
  text: string
  tone?: 'info' | 'warn' | 'danger' | 'ok'
  busy?: boolean
  actionLabel?: string
  onAction?: () => void
}

function StatusRow({ icon, text, tone = 'info', busy, actionLabel, onAction }: StatusRowProps) {
  const color =
    tone === 'danger' ? 'var(--red)'
    : tone === 'warn' ? 'var(--amber)'
    : tone === 'ok' ? 'var(--green)'
    : 'var(--body)'
  return (
    <div
      role="status"
      aria-busy={busy || undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 12,
        fontSize: 12.5,
        color,
      }}
    >
      <Icon name={icon} size={16} color={color} />
      <span style={{ flex: 1 }}>{text}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          style={{
            padding: '4px 10px',
            border: `1px solid ${color}`,
            borderRadius: 'var(--r-chip)',
            background: 'transparent',
            fontSize: 12,
            color,
            cursor: 'pointer',
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
