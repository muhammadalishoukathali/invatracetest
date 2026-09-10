/** Iteration 2 Phase 3 - Epic 3 safe-response location context surface.
 *
 *  Renders the three server states (inside_protected_area /
 *  no_intersection / boundary_uncertain) plus the two permission
 *  edge-states the endpoint itself cannot see (permission denied by the
 *  OS, geolocation call failing). Emits ``action_eligible`` upward via
 *  onEligibilityChange so the caller can hide active-removal steps
 *  without the card having to reach into the guidance panel.
 *
 *  Only fresh device coordinates are used (no cached last-known); AC
 *  3.3.1a forbids acting on stale fixes.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { Icon } from '@/components/Icon'
import {
  fetchLocationContext,
  type LocationContextResult,
  type LocationContextState,
} from '@/services/location-context'

type CardStatus =
  | 'idle'
  | 'permission_denied'
  | 'permission_prompting'
  | 'awaiting_fix'
  | 'querying'
  | 'ready'
  | 'geolocation_failed'
  | 'service_failed'

interface Props {
  onEligibilityChange?: (eligible: boolean) => void
}

type Tone = 'info' | 'warn' | 'danger' | 'ok'

const STATE_COPY: Record<LocationContextState, {
  title: string
  tone: Tone
  detail: string
}> = {
  inside_protected_area: {
    title: 'Inside a protected area',
    tone: 'danger',
    detail:
      'This spot falls inside a gazetted protected boundary. Removal is not permitted here without site-manager approval - report the sighting and leave the plant in place.',
  },
  no_intersection: {
    title: 'Outside any known protected boundary',
    tone: 'info',
    detail:
      'This spot does not fall inside a protected area in our dataset. Active removal is still gated on your permission to act at this specific site.',
  },
  boundary_uncertain: {
    title: 'Boundary check unavailable',
    tone: 'warn',
    detail:
      'The boundary check could not be completed with confidence. Treat this location as protected until it can be verified - do not remove the plant.',
  },
}

const TONE_STYLES: Record<Tone, { bg: string; border: string; color: string }> = {
  info: { bg: 'var(--surface)', border: 'var(--border)', color: 'var(--body)' },
  warn: { bg: '#FEF3E2', border: '#F0D9A8', color: 'var(--amber)' },
  danger: { bg: 'var(--red-light)', border: 'var(--red-border)', color: 'var(--red)' },
  ok: { bg: 'var(--green-light)', border: 'var(--green-border)', color: 'var(--green)' },
}

export function LocationContextCard({ onEligibilityChange }: Props) {
  const [status, setStatus] = useState<CardStatus>('idle')
  const [result, setResult] = useState<LocationContextResult | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  // Prevent stale onEligibilityChange emits when the caller unmounts us.
  const emit = useRef(onEligibilityChange)
  emit.current = onEligibilityChange

  const publishEligibility = useCallback((eligible: boolean) => {
    emit.current?.(eligible)
  }, [])

  const request = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('geolocation_failed')
      setErrorText('Location services are not available on this device.')
      publishEligibility(false)
      return
    }

    setStatus('permission_prompting')
    setErrorText(null)
    // AC 3.3.1a - if permission is already denied we surface the re-request
    // action without ever calling /location-context. Denied = card stays
    // in a locked state; the button below re-runs the flow.
    if (navigator.permissions && 'query' in navigator.permissions) {
      try {
        const state = await navigator.permissions.query({
          name: 'geolocation' as PermissionName,
        })
        if (state.state === 'denied') {
          setStatus('permission_denied')
          publishEligibility(false)
          return
        }
      } catch {
        // Some browsers still throw on 'geolocation' - fall through to the
        // real getCurrentPosition call which will re-surface the error.
      }
    }

    setStatus('awaiting_fix')
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 15_000,
        })
      })
      setStatus('querying')
      const body = await fetchLocationContext({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyM: position.coords.accuracy,
      })
      setResult(body)
      setStatus('ready')
      publishEligibility(body.actionEligible)
    } catch (err: unknown) {
      const isPermission =
        typeof err === 'object'
        && err !== null
        && 'code' in err
        && (err as GeolocationPositionError).code === 1
      if (isPermission) {
        setStatus('permission_denied')
      } else {
        setStatus('service_failed')
        setErrorText(
          'The location check could not complete. Treat this spot as protected until it can be verified.',
        )
      }
      publishEligibility(false)
    }
  }, [publishEligibility])

  useEffect(() => {
    // Kick the flow on mount so the card starts checking as soon as the
    // scan result renders - the user shouldn't have to hunt for a button.
    void request()
  }, [request])

  if (status === 'permission_denied') {
    return (
      <StatusCard
        tone="warn"
        title="Location permission required"
        detail="InvaTrace needs your location to check if this spot is inside a protected area. Grant location access to continue."
        icon="MapPin"
        actionLabel="Re-check location"
        onAction={request}
      />
    )
  }

  if (status === 'idle' || status === 'permission_prompting' || status === 'awaiting_fix' || status === 'querying') {
    return (
      <StatusCard
        tone="info"
        title="Checking site boundaries..."
        detail="Fetching a fresh location and matching against the protected-area boundary dataset."
        icon="MapPin"
        busy
      />
    )
  }

  if (status === 'geolocation_failed' || status === 'service_failed' || !result) {
    return (
      <StatusCard
        tone="warn"
        title="Boundary check unavailable"
        detail={
          errorText
          ?? 'The location check could not complete. Treat this spot as protected until it can be verified.'
        }
        icon="AlertTriangle"
        actionLabel="Try again"
        onAction={request}
      />
    )
  }

  const copy = STATE_COPY[result.contextState]
  const tone = TONE_STYLES[copy.tone]

  return (
    <section
      aria-labelledby="location-context-heading"
      aria-live="polite"
      style={{
        marginTop: 16,
        padding: 14,
        borderRadius: 'var(--r-card)',
        background: tone.bg,
        border: `1px solid ${tone.border}`,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Icon name="MapPin" size={18} color={tone.color} />
        <div style={{ flex: 1 }}>
          <h3
            id="location-context-heading"
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 700,
              color: tone.color,
              lineHeight: 1.4,
            }}
          >
            {copy.title}
          </h3>
          <p style={{
            marginTop: 6, marginBottom: 0,
            fontSize: 12.5, color: 'var(--body)', lineHeight: 1.55,
          }}>
            {copy.detail}
          </p>
          {result.contextState === 'inside_protected_area' && result.boundaryName && (
            <p style={{
              marginTop: 8, marginBottom: 0,
              fontSize: 12, color: 'var(--body)', lineHeight: 1.5,
            }}>
              <strong>{result.boundaryName}</strong>
            </p>
          )}
          <BoundaryAttribution result={result} />
        </div>
      </div>
      <button
        type="button"
        onClick={request}
        style={{
          marginTop: 12,
          padding: '6px 12px',
          border: `1px solid ${tone.border}`,
          borderRadius: 'var(--r-chip)',
          background: 'transparent',
          fontSize: 12,
          color: tone.color,
          cursor: 'pointer',
        }}
      >
        Re-check location
      </button>
    </section>
  )
}

function BoundaryAttribution({ result }: { result: LocationContextResult }) {
  const attribution: string[] = []
  if (result.boundarySource) attribution.push(result.boundarySource)
  if (result.boundaryVersion) attribution.push(`v${result.boundaryVersion}`)
  const checked = new Date(result.checkedAt)
  const checkedLabel = Number.isNaN(checked.getTime())
    ? null
    : checked.toLocaleString()
  if (attribution.length === 0 && !checkedLabel) return null
  return (
    <p style={{
      marginTop: 10, marginBottom: 0,
      fontSize: 11, color: 'var(--muted)', lineHeight: 1.5,
    }}>
      {attribution.length > 0 && `Boundary source: ${attribution.join(' · ')}`}
      {attribution.length > 0 && checkedLabel && ' · '}
      {checkedLabel && `Checked ${checkedLabel}`}
      {' · '}
      {`Accuracy ceiling ${result.accuracyCeilingM} m`}
    </p>
  )
}

interface StatusCardProps {
  tone: Tone
  title: string
  detail: string
  icon: string
  actionLabel?: string
  onAction?: () => void
  busy?: boolean
}

function StatusCard({ tone, title, detail, icon, actionLabel, onAction, busy }: StatusCardProps) {
  const style = TONE_STYLES[tone]
  return (
    <section
      aria-live="polite"
      aria-busy={busy || undefined}
      style={{
        marginTop: 16,
        padding: 14,
        borderRadius: 'var(--r-card)',
        background: style.bg,
        border: `1px solid ${style.border}`,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Icon name={icon} size={18} color={style.color} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: style.color, lineHeight: 1.4 }}>
            {title}
          </div>
          <p style={{
            marginTop: 6, marginBottom: 0,
            fontSize: 12.5, color: 'var(--body)', lineHeight: 1.55,
          }}>
            {detail}
          </p>
        </div>
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          style={{
            marginTop: 12,
            padding: '6px 12px',
            border: `1px solid ${style.border}`,
            borderRadius: 'var(--r-chip)',
            background: 'transparent',
            fontSize: 12,
            color: style.color,
            cursor: 'pointer',
          }}
        >
          {actionLabel}
        </button>
      )}
    </section>
  )
}
