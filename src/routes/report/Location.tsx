import { useEffect, useState } from 'react'
import { Icon } from '@/components/Icon'
import { useReport } from '@/lib/report-store'
import { NextButton } from './parts/NextButton'

type Status = 'idle' | 'locating' | 'located' | 'denied' | 'unavailable'

/** Bukit Kiara centre — sensible manual-entry starting point. */
const DEFAULT_LOC = { lat: 3.1497, lng: 101.6412 }

export function Location() {
  const { draft, setLocation, next } = useReport()
  const [status, setStatus] = useState<Status>('idle')
  const [manualLat, setManualLat] = useState('')
  const [manualLng, setManualLng] = useState('')

  const loc = draft?.location ?? null
  const accuracy = draft?.locationAccuracyM ?? null

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
    if (!loc && status === 'idle') requestGeolocation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [manualError, setManualError] = useState<string | null>(null)

  /** Iteration 1 pilot area is Malaysia (design-system pages/report.md).
   *  Reject anything outside the country bounds so the coordinator queue
   *  never gets a report from Singapore's downtown by accident. */
  const applyManual = () => {
    const lat = parseFloat(manualLat)
    const lng = parseFloat(manualLng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setManualError('Enter both latitude and longitude as numbers.')
      return
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setManualError('Coordinates out of range.')
      return
    }
    if (lat < 0.8 || lat > 7.5 || lng < 99.3 || lng > 119.5) {
      setManualError('Coordinates fall outside Malaysia — Iteration 1 covers Malaysia only.')
      return
    }
    setManualError(null)
    setLocation({ lat, lng }, null)
    setStatus('located')
  }

  const canProceed = !!loc

  return (
    <div style={{ padding: 16, maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 14, color: 'var(--body)', lineHeight: 1.6 }}>
        Where did you see this plant? Accurate location helps coordinators verify and prioritise removal.
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
               body="Enable location in your browser settings, or enter coordinates below." />
        )}

        {status === 'unavailable' && (
          <Row icon="AlertTriangle" tint="var(--amber)"
               title="Geolocation not supported"
               body="Use manual entry below." />
        )}

        {loc && (
          <Row icon="MapPin" tint="var(--green)"
               title={`${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`}
               body={accuracy != null ? `Accurate to ~${accuracy} m` : 'Manual entry'} />
        )}

        <button type="button" onClick={requestGeolocation} disabled={status === 'locating'} style={{
          marginTop: 14, width: '100%', height: 'var(--h-nav)', borderRadius: 'var(--r-button)',
          border: '1px solid var(--border)', background: 'var(--hover)',
          fontWeight: 500, fontSize: 13, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <Icon name="Crosshair" size={16} color="var(--body)" />
          {loc ? 'Re-locate me' : 'Use my current location'}
        </button>
      </div>

      <details style={{
        padding: 16, background: 'var(--surface)', borderRadius: 'var(--r-card)',
        border: '1px solid var(--border)',
      }}>
        <summary style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer', color: 'var(--body)' }}>
          Enter coordinates manually
        </summary>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label="Latitude" value={manualLat} onChange={setManualLat} placeholder={String(DEFAULT_LOC.lat)} />
            <Field label="Longitude" value={manualLng} onChange={setManualLng} placeholder={String(DEFAULT_LOC.lng)} />
          </div>
          <button type="button" onClick={applyManual} style={{
            height: 'var(--h-nav)', borderRadius: 'var(--r-button)',
            border: '1px solid var(--green-border)', background: 'var(--green-light)',
            color: 'var(--green-dark)', fontWeight: 600, fontSize: 13, cursor: 'pointer',
          }}>
            Apply coordinates
          </button>
          {manualError && (
            <p role="alert" style={{
              fontSize: 12, color: 'var(--red)', margin: 0, lineHeight: 1.5,
            }}>
              {manualError}
            </p>
          )}
        </div>
      </details>

      <NextButton disabled={!canProceed} onClick={next} label="Continue" />
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

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string
}) {
  return (
    <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>{label}</span>
      <input
        type="text" inputMode="decimal" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          height: 'var(--h-nav)', padding: '0 12px', borderRadius: 'var(--r-input)',
          border: '1px solid var(--border)', background: 'var(--surface)',
          fontSize: 14, fontFamily: 'var(--font-mono)', color: 'var(--ink)',
        }}
      />
    </label>
  )
}
