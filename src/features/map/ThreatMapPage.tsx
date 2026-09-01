/**
 * Displays reported sightings on a MapLibre map. The map uses a light raster
 * basemap so the risk-coloured markers stay readable. Camera bounds keep users
 * inside Malaysia, and provider attribution remains visible on every screen.
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as maplibregl from 'maplibre-gl'
import type { Map, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

import { api } from '@/services/api-client'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useMapView as useMapStore } from '@/features/map/map-view-store'
import type { Sighting } from '@/types'
import { SightingDetailsSheet } from './SightingDetailsSheet'
import { MapLegend } from './MapLegend'
import { Icon } from '@/components/Icon'

// Give MapLibre the worker file explicitly. Its automatic URL points beside
// Vite's optimized dependency file during development, where the worker does
// not exist. Importing it as an asset works in both development and production.
maplibregl.setWorkerUrl(mapLibreWorkerUrl)

const CENTRE: [number, number] = [101.6412, 3.1497]  // Bukit Kiara starting point.
const INITIAL_ZOOM = 13
const INITIAL_ZOOM_MOBILE = 13.5

// Approximate Malaysia boundary used to limit map panning.
const MY_BOUNDS: [[number, number], [number, number]] = [
  [99.3, 0.8],   // South-west corner.
  [119.5, 7.5],  // North-east corner.
]

/** Tile provider is env-configurable so production can use a keyed provider
 *  (MapTiler, Stadia, self-hosted) instead of OSM's shared tiles which are
 *  rate-limited and not for production. Set VITE_MAP_TILE_URL and
 *  VITE_MAP_TILE_ATTRIBUTION in .env to override. */
const TILE_URL =
  (import.meta.env.VITE_MAP_TILE_URL as string | undefined) ??
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  (import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined) ??
  '© <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'

const STYLE_URL: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'basemap-src': {
      type: 'raster',
      tiles: [TILE_URL],
      tileSize: 256,
      maxzoom: 19,
      attribution: TILE_ATTRIBUTION,
    },
  },
  layers: [{ id: 'basemap', type: 'raster', source: 'basemap-src' }],
}

export function ThreatMapPage() {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<Map | null>(null)
  const markers = useRef<Marker[]>([])
  const isDesktop = useIsDesktop()
  const { species, statuses, risks, search, select } = useMapStore()
  const [locationNotice, setLocationNotice] = useState<{
    tone: 'pending' | 'success' | 'error'
    text: string
  } | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sightings', species, statuses, risks, search],
    queryFn: () => {
      const params = new URLSearchParams()
      species.forEach((value) => params.append('species', value))
      statuses.forEach((value) => params.append('status', value))
      risks.forEach((value) => params.append('risk', value))
      if (search.trim()) params.set('q', search.trim())
      const query = params.toString()
      return api<{ items: Sighting[] }>(`/api/v1/sightings${query ? `?${query}` : ''}`)
    },
    staleTime: 60_000,
    refetchInterval: 15_000,
  })

  // Create one MapLibre instance for this page and remove it when the page closes.
  useEffect(() => {
    if (!container.current || map.current) return
    const m = new maplibregl.Map({
      container: container.current,
      style: STYLE_URL,
      center: CENTRE,
      zoom: isDesktop ? INITIAL_ZOOM : INITIAL_ZOOM_MOBILE,
      minZoom: 6,
      maxZoom: 19,
      maxBounds: MY_BOUNDS,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,          // Dragging should move the map, not rotate it.
      touchZoomRotate: true,
      touchPitch: false,
    })
    // Keep provider credits visible. Mobile CSS wraps them so they do not cover
    // the raised scan button.
    // Attribution is rendered by <MapAttribution/> instead of MapLibre's
    // AttributionControl. The built-in control auto-opens on load and covers
    // the scan button on small screens; a plain link chip stays predictable.
    m.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right')
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      showUserLocation: true, trackUserLocation: false,
    })
    m.addControl(geolocate, 'top-right')
    geolocate.on('geolocate', () => {
      setLocationNotice({ tone: 'success', text: 'Map centred on your current location.' })
    })
    geolocate.on('error', () => {
      setLocationNotice({
        tone: 'error',
        text: 'Your location is unavailable. Allow location access in your browser settings, then reload this page.',
      })
    })
    const locationButton = container.current.querySelector<HTMLButtonElement>('.maplibregl-ctrl-geolocate')
    const onLocationRequest = () => {
      setLocationNotice({ tone: 'pending', text: 'Finding your location…' })
    }
    locationButton?.addEventListener('click', onLocationRequest)
    map.current = m
    if (import.meta.env.DEV) (window as unknown as { __map?: Map }).__map = m

    // Some MapLibre v6 sessions parse the style before the container has its
    // final size and then request no tiles. Resizing and resetting the camera
    // after `style.load` makes MapLibre calculate the visible tile area again.
    m.once('style.load', () => {
      m.resize()
      m.jumpTo({ center: CENTRE, zoom: isDesktop ? INITIAL_ZOOM : INITIAL_ZOOM_MOBILE })
    })

    // The app shell may resize after the map mounts. ResizeObserver keeps the
    // canvas dimensions matched to the actual container.
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(container.current)

    return () => {
      locationButton?.removeEventListener('click', onLocationRequest)
      ro.disconnect()
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Remove the old markers and rebuild them whenever the data or filters change.
  useEffect(() => {
    if (!map.current || !data) return

    markers.current.forEach((m) => m.remove())
    markers.current = []

    const q = search.trim().toLowerCase()
    const filtered = data.items.filter((s) => {
      if (species.length && !species.includes(s.speciesId)) return false
      if (statuses.length && !statuses.includes(s.status)) return false
      if (risks.length && !risks.includes(s.risk)) return false
      if (q && !s.speciesName.toLowerCase().includes(q) && !s.latinName.toLowerCase().includes(q)) return false
      return true
    })

    for (const s of filtered) {
      const el = pinElement(s)
      el.addEventListener('click', () => select(s.id))
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([s.location.lng, s.location.lat])
        .addTo(map.current!)
      markers.current.push(marker)
    }
  }, [data, species, statuses, risks, search, select])

  const filtered = data
    ? data.items.filter((s) => {
        const q = search.trim().toLowerCase()
        if (species.length && !species.includes(s.speciesId)) return false
        if (statuses.length && !statuses.includes(s.status)) return false
        if (risks.length && !risks.includes(s.risk)) return false
        if (q && !s.speciesName.toLowerCase().includes(q) && !s.latinName.toLowerCase().includes(q)) return false
        return true
      })
    : []

  return (
    <div style={{
      position: 'relative', height: '100%', minHeight: 0,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* MapFilters (search + species chips + status/risk filters) removed —
          those controls belong to a coordinator role that doesn't exist yet.
          The accessible sighting list still exposes every marker to screen
          readers per AC 4.2.3. */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={container} style={{
          position: 'absolute', inset: 0,
          touchAction: 'none',   // MapLibre handles pinch, drag, and tap gestures.
        }} />
        {isLoading && (
          <div className="map-state map-state--loading" role="status" aria-live="polite">
            <span className="map-state__pulse" aria-hidden />
            Loading community reports…
          </div>
        )}
        {isError && (
          <div className="map-state map-state--error" role="alert">
            <Icon name="WifiOff" size={18} color="var(--red-text)" />
            <span>Reports could not load.</span>
            <button type="button" onClick={() => void refetch()}>Try again</button>
          </div>
        )}
        {!isLoading && !isError && data?.items.length === 0 && (
          <div className="map-state map-state--empty" role="status">
            <Icon name="MapPin" size={18} color="var(--green-dark)" />
            No community reports are visible yet.
          </div>
        )}
        <MapLegend />
        <MapAttribution />
        {locationNotice && (
          <div
            className={`map-location-notice map-location-notice--${locationNotice.tone}`}
            role={locationNotice.tone === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            <Icon
              name={locationNotice.tone === 'error' ? 'MapPinOff' : 'LocateFixed'}
              size={17}
              color="currentColor"
            />
            <span>{locationNotice.text}</span>
            <button type="button" onClick={() => setLocationNotice(null)} aria-label="Dismiss location message">
              <Icon name="X" size={15} color="currentColor" />
            </button>
          </div>
        )}
      </div>
      <AccessibleSightingList items={filtered} onSelect={select} />
      <SightingDetailsSheet />
    </div>
  )
}

/**
 * Compact OpenStreetMap credit chip. Positioned to avoid the scan button on
 * mobile and to sit above the MapLibre nav controls on desktop.
 */
function MapAttribution() {
  return (
    <a
      href="https://openstreetmap.org/copyright"
      target="_blank"
      rel="noopener noreferrer"
      className="map-attribution"
      aria-label="OpenStreetMap contributors — data license"
    >
      © OpenStreetMap contributors
    </a>
  )
}

/**
 * Screen-reader-only, keyboard-operable mirror of the map pins.
 * Marker/list count parity per AC 4.2.3 — every marker has a matching
 * list item so report details remain reachable without the canvas.
 */
function AccessibleSightingList({
  items, onSelect,
}: { items: Sighting[]; onSelect: (id: string) => void }) {
  return (
    <section aria-label="Community reports list" className="sr-only">
      <p>{items.length} community reports match the current filters.</p>
      <ul>
        {items.map((s) => {
          const statusLabel = s.status === 'screened'
            ? 'Community report — not expert validated'
            : 'Removed'
          const tierLabel = PIN_TIERS[pinTier(s)].label
          return (
            <li key={s.id}>
              <button type="button" onClick={() => onSelect(s.id)}>
                {s.speciesName} ({s.latinName}) — {tierLabel} — {statusLabel}
                {' — '}
                {s.place.source === 'fallback' || !s.place.displayName
                  ? 'No named trail, park or forest found nearby'
                  : s.place.displayName}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * Colour a marker by report density. All sightings in the map are already
 * screened invasive species, so the meaningful signal to visualise is how
 * many people have reported the same spot — a hotspot needs faster action
 * than a single isolated sighting.
 *
 *   5+ reports  → red     (hotspot — dense cluster of observations)
 *   2–4 reports → amber   (spreading — small cluster)
 *   1 report    → green   (isolated — single community sighting)
 *   removed     → grey    (record kept for audit, no longer active)
 */
type PinTier = 'hotspot' | 'spreading' | 'isolated' | 'removed'

export const PIN_TIERS: Record<PinTier, { fill: string; label: string }> = {
  hotspot: { fill: '#C2412D', label: 'Hotspot (5+ reports)' },
  spreading: { fill: '#D9880F', label: 'Spreading (2–4 reports)' },
  isolated: { fill: '#2E7D3F', label: 'Isolated (1 report)' },
  removed: { fill: '#8B978F', label: 'Removed' },
}

export function pinTier(s: Pick<Sighting, 'status' | 'reportCount'>): PinTier {
  if (s.status === 'removed') return 'removed'
  if (s.reportCount >= 5) return 'hotspot'
  if (s.reportCount >= 2) return 'spreading'
  return 'isolated'
}

/**
 * Build a DOM element for a sighting marker. The marker is a "teardrop" so it
 * points at the exact coordinate rather than hovering ambiguously nearby.
 */
function pinElement(s: Sighting): HTMLElement {
  const el = document.createElement('button')
  el.type = 'button'
  const statusLabel = s.status === 'screened'
    ? 'Community report — not expert validated'
    : 'Removed'
  const tier = pinTier(s)
  const tierInfo = PIN_TIERS[tier]
  const ariaLabel = `${s.speciesName} — ${tierInfo.label} — ${statusLabel}`
  el.setAttribute('aria-label', ariaLabel)
  el.title = `${tierInfo.label}\n${statusLabel}`
  el.dataset.sightingId = s.id
  el.dataset.tier = tier
  el.className = 'map-pin'
  const isRemoved = tier === 'removed'
  el.innerHTML = `
    <svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3));">
      <path d="M13 33 C 13 33 24 20 24 11 A 11 11 0 1 0 2 11 C 2 20 13 33 13 33 Z"
            fill="${tierInfo.fill}" stroke="#fff" stroke-width="2" />
      <circle cx="13" cy="11" r="4.5" fill="#fff" opacity="${isRemoved ? 0.6 : 0.9}" />
    </svg>`
  el.style.cssText = `
    width: 26px; height: 34px; padding: 0; background: transparent;
    border: none; cursor: pointer; opacity: ${isRemoved ? 0.7 : 1};
    -webkit-tap-highlight-color: transparent;
  `
  return el
}
