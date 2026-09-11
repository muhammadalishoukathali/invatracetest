import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useReportDraft } from '@/features/report/report-draft-store'
import { useScan } from '@/features/scan/scan-store'
import { ReportNextButton } from './components/ReportNextButton'
import { accuracyExceedsThreshold, formatAccuracyMessage } from './gps-policy'
import { useLimits } from '@/services/config-limits'

type Status = 'idle' | 'locating' | 'located' | 'denied' | 'unavailable'

// These need to match the server's Malaysia bounds check exactly, otherwise
// a coordinate that looks fine on the client could still get rejected later.
const MY_LAT_MIN = 0.8
const MY_LAT_MAX = 7.5
const MY_LNG_MIN = 99.3
const MY_LNG_MAX = 119.5

function inMalaysia(p: { lat: number; lng: number } | null): boolean {
  if (!p) return false
  return p.lat >= MY_LAT_MIN && p.lat <= MY_LAT_MAX
    && p.lng >= MY_LNG_MIN && p.lng <= MY_LNG_MAX
}

/**
 * Step 1 of 4 in the report wizard (location, extent, consent, preview).
 * The idea here is to reuse the GPS fix that was already taken when the user
 * scanned the plant, so we're not asking for location permission a second
 * time right after. We only let the user continue once we have a location
 * that's inside Malaysia bounds and has a real accuracy value, because the
 * screening pipeline on the backend needs a usable fix to work with.
 */
export function ReportLocationStep() {
  const { draft, setLocation, next, reset } = useReportDraft()
  const navigate = useNavigate()
  const location = useLocation()
  const scanLoc = useScan((s) => s.location)
  const scanLocStatus = useScan((s) => s.locationStatus)
  const [status, setStatus] = useState<Status>('idle')
  // AC 7.3.1 - read the accuracy ceiling from the server config, not a
  // hardcoded copy in the client. `useLimits()` is cached aggressively so
  // this is a memory read after the first hydration.
  const { data: limits, isPending: limitsPending, isError: limitsError } = useLimits()
  const accuracyThresholdM = limits?.locationAccuracyMaxM ?? null

  const cancelReport = () => {
    // We don't throw away the scan here - just cancel the report - so the
    // user can come back and try submitting again without redoing the scan.
    reset()
    navigate('/scan/result', { state: location.state })
  }

  const loc = draft?.location ?? null
  const accuracy = draft?.locationAccuracyM ?? null

  /* If the scan already grabbed a location, just use that instead of asking
   * the browser for permission again - nobody wants two location prompts in
   * a row for the same walk in the park. */
  useEffect(() => {
    if (loc) return
    if (scanLoc) {
      setLocation(scanLoc.point, scanLoc.accuracyM)
      setStatus('located')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanLoc])

  const requestGeolocation = () => {
    if (!('geolocation' in navigator)) { setStatus('unavailable'); return }
    setStatus('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation(
          { lat: pos.coords.latitude, lng: pos.coords.longitude },
          Math.round(pos.coords.accuracy),
        )
        setStatus('located')
      },
      () => setStatus('denied'),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    )
  }

  useEffect(() => {
    if (loc || scanLoc || status !== 'idle') return
    // We wait for the scan screen's own location request to finish first -
    // if we fire our own request while that one is still pending, the
    // browser can pop the permission prompt twice, which looks broken.
    if (scanLocStatus === 'locating') return
    requestGeolocation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanLocStatus])

  // One of the ACs was clear that there's no hard accuracy cutoff for
  // submitting - we only require a real, non-negative accuracy number and a
  // coordinate that's actually inside Malaysia. The accuracy threshold from
  // gps-policy.ts is only used as a soft warning below; we never block on it
  // client-side. If the user submits anyway with a bad fix, the server will
  // still bounce it back as needs_rescan with the same message, so nothing
  // gets silently accepted.
  const hasFiniteAccuracy = accuracy !== null && Number.isFinite(accuracy) && accuracy >= 0
  const withinMalaysia = inMalaysia(loc)
  const canProceed = !!loc && hasFiniteAccuracy && withinMalaysia
  const accuracyWarning = accuracyThresholdM != null
    && accuracyExceedsThreshold(accuracy, accuracyThresholdM)

  return (
    <div style={{ padding: 16, maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 14, color: 'var(--body)', lineHeight: 1.6 }}>
        Where did you see this plant? Accurate location helps automated checks associate the nearest park or trail.
      </p>

      <div style={{
        padding: 16, background: 'var(--surface)', borderRadius: 'var(--r-card)',
        border: '1px solid var(--border)',
      }}>
        {status === 'locating' && (
          <Row icon="Clock" tint="var(--muted)"
               title="Finding your location…"
               body="Make sure location services are enabled." />
        )}

        {status === 'denied' && (
          <Row icon="AlertTriangle" tint="var(--amber)"
               title="Location access denied"
               body="Enable location in your browser settings before continuing. Automated screening requires a GPS fix." />
        )}

        {status === 'unavailable' && (
          <Row icon="AlertTriangle" tint="var(--amber)"
               title="Geolocation not supported"
               body="This browser cannot provide the GPS evidence required for a field report." />
        )}

        {loc && (
          <Row icon="MapPin" tint="var(--green)"
               title={`${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`}
               body={(() => {
                 const accStr = accuracy != null ? `Accurate to ~${accuracy} m` : 'Accuracy unavailable'
                 const usedScanFix = !!scanLoc &&
                   scanLoc.point.lat === loc.lat && scanLoc.point.lng === loc.lng
                 return usedScanFix ? `${accStr} · captured at scan` : accStr
               })()} />
        )}

        {loc && accuracyWarning && accuracyThresholdM != null && (
          <div style={{ marginTop: 12 }}>
            <Row icon="AlertTriangle" tint="var(--amber)"
                 title="Location fix is approximate"
                 body={formatAccuracyMessage(accuracy, accuracyThresholdM)} />
          </div>
        )}

        {loc && hasFiniteAccuracy && limitsPending && (
          <div style={{ marginTop: 12 }}>
            <Row icon="Clock" tint="var(--muted)"
                 title="Checking accuracy policy…"
                 body="One moment while we confirm the current accuracy requirement." />
          </div>
        )}

        {loc && hasFiniteAccuracy && limitsError && (
          <div style={{ marginTop: 12 }}>
            <Row icon="AlertTriangle" tint="var(--amber)"
                 title="Accuracy policy unavailable"
                 body="The server's current accuracy requirement could not be loaded, so no warning is shown. You can still submit." />
          </div>
        )}

        {loc && hasFiniteAccuracy && !withinMalaysia && (
          <div style={{ marginTop: 12 }}>
            <Row icon="AlertTriangle" tint="var(--amber)"
                 title="Location is outside Malaysia"
                 body="InvaTrace currently accepts reports inside Malaysia only. Re-locate on a device inside the country." />
          </div>
        )}

        <button type="button" onClick={requestGeolocation} disabled={status === 'locating'} style={{
          marginTop: 14, width: '100%', height: 'var(--h-nav)', borderRadius: 'var(--r-button)',
          border: '1px solid var(--border)', background: 'var(--hover)',
          fontWeight: 500, fontSize: 13, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <Icon name="Crosshair" size={16} color="var(--body)" />
          {status === 'denied' || status === 'unavailable'
            ? 'Retry location'
            : loc ? 'Re-locate me' : 'Use my current location'}
        </button>

        {(status === 'denied' || status === 'unavailable') && (
          <button type="button" onClick={cancelReport} style={{
            marginTop: 8, width: '100%', height: 'var(--h-nav)', borderRadius: 'var(--r-button)',
            border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--body)',
            fontWeight: 500, fontSize: 13, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <Icon name="X" size={16} color="var(--body)" />
            Cancel report - keep scan
          </button>
        )}
      </div>

      <ReportNextButton disabled={!canProceed} onClick={next} label="Continue" />
    </div>
  )
}

function Row({ icon, tint, title, body }: { icon: string; tint: string; title: string; body: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%', background: 'var(--green-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon name={icon} size={20} color={tint} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{body}</div>
      </div>
    </div>
  )
}
