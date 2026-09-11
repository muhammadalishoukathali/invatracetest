/**
 * This is the main map screen at `/map`. After a user scans a plant (or if
 * they just want to browse), they end up here and can see every community
 * report near them. Honestly this was one of the trickier pages to build
 * because we had to juggle the map library, the filter panel and the
 * paginated fetch all together.
 *
 * We went with MapLibre GL instead of Google Maps because it's free and
 * works with any tile source - matters for the FYP because we don't have
 * a Google billing account set up. The whole thing is capped to Malaysia
 * bounds so users can't wander off to another country by accident.
 *
 * Rough flow: MapFilters.tsx writes the species/status/risk/search choices
 * into map-view-store.ts, and this page reads that store to fetch and
 * filter sightings and rebuild the markers. MapLegend.tsx floats on top of
 * the map to explain what the pin colours mean. When someone taps a pin
 * (or a row in the screen-reader list below the map), we call `select()`
 * on the store and SightingDetailsSheet.tsx picks that up to open the
 * details. A `?sighting=` query param or a "My Reports" nav state can
 * also drive the initial camera position - see map-location-link.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map, MapGeoJSONFeature, MapMouseEvent, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

import { api } from '@/services/api-client'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { useMapView as useMapStore } from '@/features/map/map-view-store'
import type { Sighting } from '@/types'
import { SightingDetailsSheet } from './SightingDetailsSheet'
import { MapLegend } from './MapLegend'
import { Icon } from '@/components/Icon'
import { parseMapLocationTarget, type MapLocationTarget } from './map-location-link'
import { PlaceLayer } from '@/features/place-discovery/PlaceLayer'
import { PlaceDiscoverySheet } from '@/features/place-discovery/PlaceDiscoverySheet'
import { usePlaces, type PlaceListItem } from '@/services/place-discovery'

// Point MapLibre at its worker file ourselves. If we don't, it tries to
// guess a URL that sits next to Vite's optimized dep file in dev, and the
// worker isn't actually there - the map just silently doesn't paint. Doing
// the ?url import means it works the same way in dev and prod.
maplibregl.setWorkerUrl(mapLibreWorkerUrl)

const CENTRE: [number, number] = [101.6412, 3.1497]  // Bukit Kiara starting point.
const INITIAL_ZOOM = 13
const INITIAL_ZOOM_MOBILE = 13.5

// Approximate Malaysia boundary used to limit map panning.
const MY_BOUNDS: [[number, number], [number, number]] = [
  [99.3, 0.8],   // South-west corner.
  [119.5, 7.5],  // North-east corner.
]

/** We keep the tile provider in an env var so that later (if we ever move
 *  past FYP demo) we can switch to a keyed provider like MapTiler or Stadia
 *  without touching code. OSM's shared tiles are rate-limited and not really
 *  meant for production, so this gives us an escape hatch. Set
 *  VITE_MAP_TILE_URL and VITE_MAP_TILE_ATTRIBUTION in .env to override. */
const TILE_URL =
  (import.meta.env.VITE_MAP_TILE_URL as string | undefined) ??
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  (import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined) ??
  '© <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'

const STYLE_URL: maplibregl.StyleSpecification = {
  version: 8,
  // Cluster count labels need a glyphs endpoint. MapLibre's demotiles CDN
  // ships an Open Sans stack that covers Latin-1 for our count-badge use
  // case; if this ever gets swapped for a self-hosted glyph server, update
  // the `text-font` used by the `cluster-count` layer below to match.
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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

// Source + layer ids for the clustered sighting overlay. Kept as constants
// so the effect that rebuilds the FeatureCollection can setData without
// re-reading string literals scattered through the file.
const SIGHTINGS_SOURCE_ID = 'sightings'
const CLUSTER_LAYER_ID = 'sightings-clusters'
const CLUSTER_COUNT_LAYER_ID = 'sightings-cluster-count'
const UNCLUSTERED_LAYER_ID = 'sightings-unclustered'
const UNCLUSTERED_REMOVED_LAYER_ID = 'sightings-unclustered-removed'
const REMOVED_ICON_ID = 'sighting-pin-removed'

/**
 * Paint one "removed" pin into an offscreen canvas so MapLibre can register
 * it as a sprite image (`map.addImage(...)`) and use it in a symbol layer.
 *
 * AC 7.2.1 — the "removed" state must be distinguishable without colour, so
 * this image bakes in the dashed outer ring and diagonal slash mark that
 * used to be drawn as inline SVG on each DOM marker. Colour-blind users and
 * anyone in high-contrast mode still get the shape cue after the switch to
 * a GeoJSON source. MapLibre's `circle` type cannot draw dashed strokes, so
 * we go via a symbol image for this tier while non-removed tiers stay on
 * the (much cheaper) `circle` layer.
 */
function buildRemovedPinImage(pixelRatio: number): ImageData | null {
  if (typeof document === 'undefined') return null
  const size = Math.round(24 * pixelRatio)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(pixelRatio, pixelRatio)
  const cx = 12
  const cy = 12
  // Greyed fill.
  ctx.beginPath()
  ctx.arc(cx, cy, 8, 0, Math.PI * 2)
  ctx.fillStyle = PIN_TIERS.removed.fill
  ctx.globalAlpha = 0.85
  ctx.fill()
  // White outer stroke for legibility on both light and dark tiles.
  ctx.globalAlpha = 1
  ctx.lineWidth = 1.25
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  // Dashed inner ring — the non-colour shape cue.
  ctx.beginPath()
  ctx.arc(cx, cy, 6, 0, Math.PI * 2)
  ctx.setLineDash([1.5, 1.5])
  ctx.lineWidth = 1
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.setLineDash([])
  // Diagonal slash — the second non-colour shape cue.
  ctx.beginPath()
  ctx.moveTo(6, 18)
  ctx.lineTo(18, 6)
  ctx.lineWidth = 1.75
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  return ctx.getImageData(0, 0, size, size)
}

export function ThreatMapPage() {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<Map | null>(null)
  // AC 7.1.2 — no DOM-per-marker beyond ~100 pins. The clustered sightings
  // overlay lives on a MapLibre GeoJSON source with cluster + unclustered
  // layers; the only DOM marker still created here is the one-off "My
  // Reports" pin (`recordLocationMarker`), which is always a single node.
  const sightingsSourceReady = useRef(false)
  const recordLocationMarker = useRef<Marker | null>(null)
  const latestVisibleSightings = useRef<Sighting[]>([])
  const reportsHaveLoaded = useRef(false)
  const locationFailed = useRef(false)
  const initialViewApplied = useRef(false)
  const targetSightingId = useRef<string | null>(null)
  const fitReportsFallback = useRef<(() => void) | null>(null)
  const isDesktop = useIsDesktop()
  const routeLocation = useLocation()
  const [searchParams] = useSearchParams()
  const requestedSightingId = searchParams.get('sighting')
  const requestedLocation = useMemo(
    () => parseMapLocationTarget(routeLocation.state),
    [routeLocation.state],
  )
  targetSightingId.current = requestedSightingId
  const { species, statuses, risks, search, select, clearFilters } = useMapStore()
  const [locationNotice, setLocationNotice] = useState<{
    tone: 'pending' | 'success' | 'error'
    text: string
  } | null>(null)
  const [recordDetailsOpen, setRecordDetailsOpen] = useState(false)
  // Wave 2c — place overlay state. `selectedPlaceId` opens the discovery
  // sheet; `viewportBbox` is a debounced snapshot of the current map
  // bounds so the places query can key its cache on it.
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)
  const [viewportBbox, setViewportBbox] = useState<[number, number, number, number] | null>(null)

  // When we successfully recenter the user, the toast is really just a
  // quick "yep, done" - no reason to leave it stuck on screen. Errors
  // though should stay put until the user dismisses them, because the
  // fallback view needs explaining (otherwise they'll wonder why the map
  // opened somewhere random).
  useEffect(() => {
    if (locationNotice?.tone !== 'success') return
    const timer = window.setTimeout(() => {
      setLocationNotice((current) => current?.tone === 'success' ? null : current)
    }, 3_500)
    return () => window.clearTimeout(timer)
  }, [locationNotice])

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
    refetchOnMount: 'always',
    refetchInterval: 15_000,
  })

  useEffect(() => {
    if (!requestedSightingId) return
    clearFilters()
  }, [clearFilters, requestedSightingId])

  // Only ever create one MapLibre instance for this page, and clean it up
  // when the page unmounts. If we let it re-init on every render we'd leak
  // canvas handles like crazy - found that out the hard way during dev.
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
    // We roll our own attribution chip (see MapAttribution below) rather
    // than using MapLibre's built-in AttributionControl. The default one
    // auto-expands on load and ends up sitting right on top of the scan
    // button on mobile, which was really annoying during pilot testing -
    // a plain link is more predictable and still credits OSM properly.
    m.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right')
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 8_000, maximumAge: 300_000 },
      showUserLocation: true, trackUserLocation: false,
    })
    m.addControl(geolocate, 'top-right')
    const showReportsFallback = (text: string) => {
      locationFailed.current = true
      fitReportsFallback.current?.()
      setLocationNotice({ tone: 'error', text })
    }
    geolocate.on('geolocate', () => {
      initialViewApplied.current = true
      setLocationNotice({ tone: 'success', text: 'Map centred on your location' })
    })
    geolocate.on('error', () => {
      showReportsFallback('Your location is unavailable, so the map is showing the visible community reports instead.')
    })
    geolocate.on('outofmaxbounds', () => {
      showReportsFallback('Your location is outside the current Malaysia map area, so the visible community reports are shown instead.')
    })
    const locationButton = container.current.querySelector<HTMLButtonElement>('.maplibregl-ctrl-geolocate')
    const onLocationRequest = () => {
      setLocationNotice({ tone: 'pending', text: 'Finding your location…' })
    }
    locationButton?.addEventListener('click', onLocationRequest)
    map.current = m
    if (import.meta.env.DEV) (window as unknown as { __map?: Map }).__map = m

    fitReportsFallback.current = () => {
      if (initialViewApplied.current || !reportsHaveLoaded.current) return
      const visible = latestVisibleSightings.current
      if (visible.length === 0) {
        m.jumpTo({ center: CENTRE, zoom: isDesktop ? INITIAL_ZOOM : INITIAL_ZOOM_MOBILE })
        initialViewApplied.current = true
        return
      }

      if (visible.length === 1) {
        const only = visible[0]
        m.easeTo({
          center: [only.location.lng, only.location.lat],
          zoom: isDesktop ? 14 : 14.5,
          duration: 650,
        })
        initialViewApplied.current = true
        return
      }

      const bounds = new maplibregl.LngLatBounds()
      visible.forEach((sighting) => bounds.extend([sighting.location.lng, sighting.location.lat]))
      m.fitBounds(bounds, {
        padding: isDesktop ? 88 : 54,
        maxZoom: isDesktop ? 14 : 14.5,
        duration: 650,
      })
      initialViewApplied.current = true
    }

    // Bit of a MapLibre v6 quirk: sometimes it parses the style before the
    // container has settled to its real size, and then it doesn't request
    // any tiles at all - you get a blank map. Forcing a resize and a jumpTo
    // once `style.load` fires nudges it to recompute what's visible.
    let locationReadyTimer: number | undefined
    m.once('style.load', () => {
      m.resize()
      // AC 7.1.2 — install the clustered sightings overlay once the style
      // has loaded. All rebuilds after this are `setData` calls on the same
      // source, so pin count no longer scales DOM node count.
      installSightingsOverlay(m, (id) => select(id))
      sightingsSourceReady.current = true
      // Backfill: if the sightings query resolved before the style did, the
      // data effect will have bailed early. Seed the source now so the map
      // paints on first load without waiting for the next refetch tick.
      const pending = latestVisibleSightings.current
      if (pending.length > 0) {
        const source = m.getSource(SIGHTINGS_SOURCE_ID) as GeoJSONSource | undefined
        source?.setData(sightingsToFeatureCollection(pending))
      }
      if (targetSightingId.current || requestedLocation) return
      m.jumpTo({ center: CENTRE, zoom: isDesktop ? INITIAL_ZOOM : INITIAL_ZOOM_MOBILE })
      setLocationNotice({ tone: 'pending', text: 'Finding your location…' })
      let checks = 0
      const triggerWhenReady = () => {
        const button = container.current?.querySelector<HTMLButtonElement>('.maplibregl-ctrl-geolocate')
        if (button && !button.disabled) {
          geolocate.trigger()
          return
        }
        checks += 1
        if (checks < 20) {
          locationReadyTimer = window.setTimeout(triggerWhenReady, 100)
          return
        }
        showReportsFallback('Location access is not available in this browser, so the visible community reports are shown instead.')
      }
      triggerWhenReady()
    })

    // The app shell can change size after the map mounts (e.g. sidebar
    // opens on desktop). ResizeObserver just keeps the canvas glued to
    // whatever the container is doing.
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(container.current)

    return () => {
      locationButton?.removeEventListener('click', onLocationRequest)
      if (locationReadyTimer !== undefined) window.clearTimeout(locationReadyTimer)
      ro.disconnect()
      fitReportsFallback.current = null
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wave 2c — track the current viewport bbox so PlaceLayer can key its
  // fetch on it. Debounced 300 ms so rapid panning does not thrash the
  // network. The initial snapshot fires once the style has loaded.
  useEffect(() => {
    const m = map.current
    if (!m) return
    let timer: number | undefined
    const capture = () => {
      const bounds = m.getBounds()
      const bbox: [number, number, number, number] = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ]
      setViewportBbox(bbox)
    }
    const onMoveEnd = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(capture, 300)
    }
    if (m.isStyleLoaded()) capture()
    else m.once('style.load', capture)
    m.on('moveend', onMoveEnd)
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      m.off('moveend', onMoveEnd)
    }
    // We only ever mount the map once, so the listener lifecycle is
    // effectively pinned to the component lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When someone comes here via a "My Reports" link they might be pointing
  // at a private scan or a draft report that hasn't actually been published
  // as a public sighting yet. So we draw its marker separately from the API
  // markers - that way a filter change or refetch can't wipe it off.
  useEffect(() => {
    if (!map.current) return
    setRecordDetailsOpen(false)
    recordLocationMarker.current?.remove()
    recordLocationMarker.current = null
    if (!requestedLocation) return

    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'map-record-location-marker'
    el.setAttribute('aria-label', `Open details for ${requestedLocation.label}`)
    el.title = requestedLocation.label
    el.addEventListener('click', () => setRecordDetailsOpen(true))
    const pin = document.createElement('div')
    pin.className = 'map-record-location-pin'
    el.append(pin)
    recordLocationMarker.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([requestedLocation.point.lng, requestedLocation.point.lat])
      .addTo(map.current)
    initialViewApplied.current = true
    map.current.easeTo({
      center: [requestedLocation.point.lng, requestedLocation.point.lat],
      zoom: isDesktop ? 16 : 16.5,
      duration: 650,
    })
    setLocationNotice({ tone: 'success', text: `Showing ${requestedLocation.label}` })

    return () => {
      recordLocationMarker.current?.remove()
      recordLocationMarker.current = null
    }
  }, [requestedLocation, isDesktop])

  // Whenever the data or filter set changes we push a fresh FeatureCollection
  // into the `sightings` source. MapLibre handles clustering and rendering,
  // so this stays cheap regardless of how many reports come back — the DOM
  // node count is fixed (AC 7.1.2), unlike the old per-marker `new Marker()`
  // loop this replaced.
  useEffect(() => {
    if (!map.current || !data) return

    const q = search.trim().toLowerCase()
    const filtered = data.items.filter((s) => {
      if (species.length && !species.includes(s.speciesId)) return false
      if (statuses.length && !statuses.includes(s.status)) return false
      if (risks.length && !risks.includes(s.risk)) return false
      if (q && !s.speciesName.toLowerCase().includes(q) && !s.latinName.toLowerCase().includes(q)) return false
      return true
    })
    latestVisibleSightings.current = filtered
    reportsHaveLoaded.current = true

    if (sightingsSourceReady.current) {
      const source = map.current.getSource(SIGHTINGS_SOURCE_ID) as GeoJSONSource | undefined
      source?.setData(sightingsToFeatureCollection(filtered))
    }

    // If we got here from a notification tap or a "My Reports" link, the
    // feature has to be visible on the map before we can select it and
    // fly the camera - that's why this bit lives at the end of the
    // rebuild, not up top.
    if (requestedSightingId) {
      const requested = filtered.find((sighting) => sighting.id === requestedSightingId)
      if (requested) {
        initialViewApplied.current = true
        select(requested.id)
        map.current.easeTo({
          center: [requested.location.lng, requested.location.lat],
          zoom: isDesktop ? 16 : 16.5,
          duration: 650,
        })
      }
    }

    if (locationFailed.current) fitReportsFallback.current?.()
  }, [data, species, statuses, risks, search, select, requestedSightingId, isDesktop])

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
  // One of the ACs (4.2.3) asked us to show how many reports are actually
  // being shown after filters are applied. I kept the "filters active"
  // count separate from the "reports shown" count on purpose - during
  // pilot testing someone read "3" and thought there were 3 reports when
  // it was actually the number of active filters. Confusing.
  const filtersActive = species.length + statuses.length + risks.length + (search.trim() ? 1 : 0)
  const resultCountLabel = `Showing ${filtered.length} ${filtered.length === 1 ? 'report' : 'reports'}`

  return (
    <div style={{
      position: 'relative', height: '100%', minHeight: 0,
      display: 'flex', flexDirection: 'column',
    }}>
      <PlaceDiscoverySheet
        placeId={selectedPlaceId}
        onClose={() => setSelectedPlaceId(null)}
      />
      <PlaceLayer
        map={map.current}
        viewport={viewportBbox ? { bbox: viewportBbox } : null}
        onPlaceClick={setSelectedPlaceId}
      />
      {/* Accessibility bit - the map canvas itself is basically invisible
          to keyboard-only or screen reader users. So we always render an
          AccessibleSightingList below that mirrors the pins, including
          during loading and error states, so the report data is still
          reachable. Came out of the Iteration 1 P9 accessibility review. */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div
          ref={container}
          role="application"
          aria-label="Interactive community reports map. A parallel list of the same reports is available below the map."
          aria-describedby="map-live-count"
          style={{
            position: 'absolute', inset: 0,
            touchAction: 'none',   // Let MapLibre handle all the touch stuff itself.
          }}
        />
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
        {/* Same AC 4.2.3 - the visible count chip. We set aria-live so
            screen readers actually hear the new number after someone
            changes a filter, rather than silently updating. */}
        <div
          id="map-live-count"
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute', top: 12, left: 12, zIndex: 5,
            padding: '6px 10px', borderRadius: 'var(--r-chip)',
            background: 'var(--surface)', border: '1px solid var(--border)',
            fontSize: 12, fontWeight: 600, color: 'var(--body)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
          }}
        >
          {resultCountLabel}
          {filtersActive > 0 && (
            <span style={{ marginLeft: 6, color: 'var(--muted)', fontWeight: 500 }}>
              · {filtersActive} filter{filtersActive === 1 ? '' : 's'} active
            </span>
          )}
        </div>
        {locationNotice && (
          <div
            className={`map-location-notice map-location-notice--${locationNotice.tone}`}
            role={locationNotice.tone === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            <Icon
              name={locationNotice.tone === 'error' ? 'MapPin' : 'Crosshair'}
              size={16}
              color="currentColor"
            />
            <span>{locationNotice.text}</span>
            <button type="button" onClick={() => setLocationNotice(null)} aria-label="Dismiss location message">
              <Icon name="X" size={15} color="currentColor" />
            </button>
          </div>
        )}
      </div>
      <AccessibleSightingList
        items={filtered}
        onSelect={select}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
      />
      <AccessiblePlaceList
        bbox={viewportBbox}
        onSelect={setSelectedPlaceId}
      />
      <SightingDetailsSheet />
      <SavedRecordDetailsSheet
        target={requestedLocation}
        open={recordDetailsOpen}
        onClose={() => setRecordDetailsOpen(false)}
      />
    </div>
  )
}

/**
 * The little detail sheet that opens when you tap a "My Reports" pin.
 * I made it a separate component from SightingDetailsSheet because the
 * data source is completely different - this one reads from React
 * Router's navigation state (see map-location-link.ts) instead of the
 * public sightings API. The record here might not even be a published
 * sighting yet, so treating it the same as a normal pin would have
 * gotten messy fast.
 */
function SavedRecordDetailsSheet({
  target,
  open,
  onClose,
}: {
  target: MapLocationTarget | null
  open: boolean
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  useDialogA11y(dialogRef, onClose, {
    active: open && !!target,
    returnFocus: () => document.querySelector<HTMLElement>('.map-record-location-marker'),
  })

  if (!open || !target) return null
  const details = target.details
  const coordinate = `${target.point.lat.toFixed(5)}, ${target.point.lng.toFixed(5)}`

  return createPortal(
    <>
      <div onClick={onClose} aria-hidden className="app-sheet-backdrop sighting-details-backdrop" />
      <aside
        ref={dialogRef}
        tabIndex={-1}
        className="pin-sheet pin-sheet--isolated saved-record-sheet"
        role="dialog"
        aria-label="Saved record details"
        aria-modal="true"
      >
        <div className="pin-sheet__handle" aria-hidden />
        <button type="button" onClick={onClose} aria-label="Close saved record details"
          className="pin-sheet__close">
          <Icon name="X" size={18} color="var(--body)" />
        </button>
        <div className="pin-sheet__content">
          <header className="saved-record-sheet__heading" tabIndex={-1} data-dialog-initial>
            <span>{details?.kind === 'scan' ? 'Saved scan' : 'Saved report'}</span>
            <h2>{target.label}</h2>
            <p>
              This is the location saved with your private record. It is separate from public community sightings until the report is published.
            </p>
          </header>
          <dl className="saved-record-sheet__facts">
            {details && <SavedRecordFact label="Status" value={details.statusLabel} />}
            {details && <SavedRecordFact label="Recorded" value={formatSavedRecordTime(details.observedAt)} />}
            <SavedRecordFact label="Coordinates" value={coordinate} mono />
            {details?.locationAccuracyM != null && (
              <SavedRecordFact label="GPS accuracy" value={`±${Math.round(details.locationAccuracyM)} m`} />
            )}
          </dl>
          {details?.kind === 'report' && details.recordId && (
            <Link className="saved-record-sheet__link" to={`/reports/${encodeURIComponent(details.recordId)}`}>
              View full report
            </Link>
          )}
        </div>
      </aside>
    </>,
    document.body,
  )
}

/** Just one row in the little facts list on the saved-record sheet
 *  (label on the left, value on the right). Pulled out so the map
 *  component doesn't get any more crowded than it already is. */
function SavedRecordFact({ label, value, mono = false }: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
    </div>
  )
}

function formatSavedRecordTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

/**
 * Small OpenStreetMap credit chip. Sits in a corner where it won't get
 * covered by the scan button on mobile, and stays above the MapLibre
 * nav buttons on desktop. We have to keep OSM attribution visible per
 * their licence, so this needs to always be there.
 */
function MapAttribution() {
  return (
    <a
      href="https://openstreetmap.org/copyright"
      target="_blank"
      rel="noopener noreferrer"
      className="map-attribution"
      aria-label="OpenStreetMap contributors - data license"
    >
      © OpenStreetMap contributors
    </a>
  )
}

/**
 * The screen-reader-only mirror of the map pins. Every marker gets a
 * matching list item, so someone using a screen reader or just tabbing
 * with the keyboard can still open the report details without ever
 * needing to interact with the actual map canvas.
 */
function AccessibleSightingList({
  items, onSelect, isLoading, isError, onRetry,
}: {
  items: Sighting[]
  onSelect: (id: string) => void
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}) {
  // The accessible fallback has to render in loading and error states too,
  // not just when data arrives. Otherwise a screen reader user who hit a
  // network error would have literally nothing to interact with - the map
  // canvas doesn't help them at all. Came from the accessibility review.
  return (
    <section aria-label="Community reports list" className="sr-only">
      {isLoading && <p role="status">Loading community reports…</p>}
      {isError && (
        <p role="alert">
          Community reports could not load.{' '}
          <button type="button" onClick={onRetry}>Try again</button>
        </p>
      )}
      {!isLoading && !isError && (
        <>
          <p>
            {items.length === 0
              ? 'No community reports match the current filters.'
              : `${items.length} community report${items.length === 1 ? '' : 's'} match the current filters.`}
          </p>
          {items.length > 0 && (
            <ul>
              {items.map((s) => {
                const statusLabel = s.status === 'screened'
                  ? 'Community report - not expert validated'
                  : 'Removed'
                const tierLabel = PIN_TIERS[pinTier(s)].label
                return (
                  <li key={s.id}>
                    <button type="button" onClick={() => onSelect(s.id)}>
                      {s.speciesName} ({s.latinName}) - {tierLabel} - {statusLabel}
                      {' - '}
                      {s.place.source === 'fallback' || !s.place.displayName
                        ? 'No named trail, park or forest found nearby'
                        : s.place.displayName}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

/** Wave 2c — screen-reader mirror of the place polygons in the current
 *  viewport, so keyboard-only users can open the discovery sheet
 *  without ever interacting with the map canvas. Skipped when the
 *  viewport list is empty. */
function AccessiblePlaceList({
  bbox,
  onSelect,
}: {
  bbox: [number, number, number, number] | null
  onSelect: (placeId: string) => void
}) {
  const { data } = usePlaces({ bbox: bbox ?? undefined })
  const items: PlaceListItem[] = data?.items ?? []
  if (items.length === 0) return null
  return (
    <section aria-label="Places in current map view" className="sr-only">
      <p>
        {`${items.length} named place${items.length === 1 ? '' : 's'} in the current map view.`}
      </p>
      <ul>
        {items.map((place) => (
          <li key={place.placeId}>
            <button type="button" onClick={() => onSelect(place.placeId)}>
              {place.displayName} ({place.placeType})
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Tiny helper - we colour active markers by how many reports they've
 *  gathered (hotspot vs spreading vs isolated), and anything marked as
 *  removed goes grey so it visually fades into the background. */
type PinTier = 'hotspot' | 'spreading' | 'isolated' | 'removed'

export const PIN_TIERS: Record<PinTier, { fill: string; label: string }> = {
  hotspot: { fill: '#C2412D', label: 'Hotspot (5+ reports)' },
  spreading: { fill: '#D9880F', label: 'Spreading (2-4 reports)' },
  isolated: { fill: '#2E7D3F', label: 'Isolated (1 report)' },
  removed: { fill: '#8B978F', label: 'Removed' },
}

export function pinTier(s: Pick<Sighting, 'status' | 'reportCount'>): PinTier {
  if (s.status === 'removed') return 'removed'
  if (s.reportCount >= 5) return 'hotspot'
  if (s.reportCount >= 2) return 'spreading'
  return 'isolated'
}

type SightingFeatureProps = {
  sighting_id: string
  tier: PinTier
  species_name: string
  observation_date: string
  status: Sighting['status']
}

/** Turn the currently-visible sighting list into a FeatureCollection the
 *  `sightings` GeoJSON source can consume. Kept as a plain function so the
 *  data effect can call `setData` without having to know how MapLibre lays
 *  out features. */
function sightingsToFeatureCollection(
  items: Sighting[],
): GeoJSON.FeatureCollection<GeoJSON.Point, SightingFeatureProps> {
  return {
    type: 'FeatureCollection',
    features: items.map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.location.lng, s.location.lat] },
      properties: {
        sighting_id: s.id,
        tier: pinTier(s),
        species_name: s.speciesName,
        observation_date: s.lastReportedAt,
        status: s.status,
      },
    })),
  }
}

/**
 * One-time setup of the clustered sightings overlay on a MapLibre map. It
 * registers the "removed" pin icon (a canvas image that bakes in the
 * dashed ring + slash shape cues from AC 7.2.1), installs the GeoJSON
 * source with supercluster options, and wires up the four render layers
 * plus click handlers.
 *
 * Layer topology:
 *   - `sightings-clusters` — filled circle sized by point_count
 *   - `sightings-cluster-count` — numeric badge on top of each cluster
 *   - `sightings-unclustered` — circle for hotspot/spreading/isolated pins
 *   - `sightings-unclustered-removed` — symbol layer for removed pins,
 *     using the canvas image so the dashed-ring + slash cues stay
 *     readable without colour.
 */
function installSightingsOverlay(
  m: Map,
  onSelect: (id: string) => void,
): void {
  const removed = buildRemovedPinImage(window.devicePixelRatio || 1)
  if (removed && !m.hasImage(REMOVED_ICON_ID)) {
    m.addImage(REMOVED_ICON_ID, removed, { pixelRatio: window.devicePixelRatio || 1 })
  }

  if (!m.getSource(SIGHTINGS_SOURCE_ID)) {
    m.addSource(SIGHTINGS_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50,
    })
  }

  if (!m.getLayer(CLUSTER_LAYER_ID)) {
    m.addLayer({
      id: CLUSTER_LAYER_ID,
      type: 'circle',
      source: SIGHTINGS_SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        // Neutral cluster colour keeps clusters visually distinct from
        // any single-tier pin colour so they read as aggregations.
        'circle-color': '#4B6B58',
        'circle-opacity': 0.9,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-radius': [
          'step', ['get', 'point_count'],
          14,
          10, 18,
          30, 22,
        ],
      },
    })
  }

  if (!m.getLayer(CLUSTER_COUNT_LAYER_ID)) {
    m.addLayer({
      id: CLUSTER_COUNT_LAYER_ID,
      type: 'symbol',
      source: SIGHTINGS_SOURCE_ID,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Open Sans Semibold'],
        'text-size': 12,
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#ffffff',
      },
    })
  }

  if (!m.getLayer(UNCLUSTERED_LAYER_ID)) {
    m.addLayer({
      id: UNCLUSTERED_LAYER_ID,
      type: 'circle',
      source: SIGHTINGS_SOURCE_ID,
      filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'tier'], 'removed']],
      paint: {
        'circle-color': [
          'match', ['get', 'tier'],
          'hotspot', PIN_TIERS.hotspot.fill,
          'spreading', PIN_TIERS.spreading.fill,
          'isolated', PIN_TIERS.isolated.fill,
          /* default */ '#666666',
        ],
        'circle-radius': 8,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
      },
    })
  }

  if (!m.getLayer(UNCLUSTERED_REMOVED_LAYER_ID)) {
    m.addLayer({
      id: UNCLUSTERED_REMOVED_LAYER_ID,
      type: 'symbol',
      source: SIGHTINGS_SOURCE_ID,
      filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'tier'], 'removed']],
      layout: {
        'icon-image': REMOVED_ICON_ID,
        'icon-size': 1,
        'icon-allow-overlap': true,
      },
    })
  }

  // Cluster click — zoom in to the expansion zoom returned by supercluster.
  m.on('click', CLUSTER_LAYER_ID, (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
    const feature = e.features?.[0]
    if (!feature) return
    const clusterId = feature.properties?.cluster_id
    const source = m.getSource(SIGHTINGS_SOURCE_ID) as GeoJSONSource | undefined
    if (typeof clusterId !== 'number' || !source) return
    void source.getClusterExpansionZoom(clusterId).then((zoom) => {
      const coords = (feature.geometry as GeoJSON.Point).coordinates
      m.easeTo({ center: [coords[0], coords[1]], zoom, duration: 500 })
    }).catch(() => {
      /* ignore — clicking a cluster that vanished mid-fetch is harmless */
    })
  })

  const onFeatureClick = (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
    const feature = e.features?.[0]
    const id = feature?.properties?.sighting_id
    if (typeof id === 'string') onSelect(id)
  }
  m.on('click', UNCLUSTERED_LAYER_ID, onFeatureClick)
  m.on('click', UNCLUSTERED_REMOVED_LAYER_ID, onFeatureClick)

  // Standard cursor affordances so users know the pins and clusters are
  // interactive even before they click.
  const setPointer = () => { m.getCanvas().style.cursor = 'pointer' }
  const clearPointer = () => { m.getCanvas().style.cursor = '' }
  for (const id of [CLUSTER_LAYER_ID, UNCLUSTERED_LAYER_ID, UNCLUSTERED_REMOVED_LAYER_ID]) {
    m.on('mouseenter', id, setPointer)
    m.on('mouseleave', id, clearPointer)
  }
}

/*
 * NOTE (AC 7.1.2): the previous `pinElement()` helper that materialised one
 * DOM marker per sighting has been removed. The map now renders every
 * sighting through the `sightings` GeoJSON source configured in
 * `installSightingsOverlay` above — no DOM node grows with pin count.
 * The one-off "My Reports" pin (single node) is still built inline in the
 * component; the accessible list mirrors sightings without any DOM markers
 * at all.
 */
