import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useReportDraft } from '@/features/report/report-draft-store'
import { useScan } from '@/features/scan/scan-store'
import { ReportNextButton } from './components/ReportNextButton'

type Status = 'idle' | 'locating' | 'located' | 'denied' | 'unavailable'

export function ReportLocationStep() {
  const { draft, setLocation, next, reset } = useReportDraft()
  const navigate = useNavigate()
  const scanLoc = useScan((s) => s.location)
  const scanLocStatus = useScan((s) => s.locationStatus)
  const [status, setStatus] = useState<Status>('idle')

  const cancelReport = () => {
    // AC 4.1.2: leaving the report keeps the valid scan around so the user can
    // retry from the result page without losing their identification.
    reset()
    navigate('/scan/result')
  }

  const loc = draft?.location ?? null
  const accuracy = draft?.locationAccuracyM ?? null

  /** Reuse the location captured with the photo. This avoids asking for the
   *  same location permission again during the report form. */
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
    // Wait for the location request started by the scan screen. Starting a
    // second request here could show the browser permission prompt twice.
    if (scanLocStatus === 'locating') return
    requestGeolocation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanLocStatus])

  const canProceed = !!loc && accuracy !== null && accuracy <= 100

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

        {loc && !canProceed && (
          <div style={{ marginTop: 12 }}>
            <Row icon="AlertTriangle" tint="var(--amber)"
                 title="A more accurate GPS fix is needed"
                 body="Move to an open area and use the location button again. Reports require accuracy within 100 m." />
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
            Cancel report — keep scan
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
