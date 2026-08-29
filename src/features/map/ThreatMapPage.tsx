/**
 * Displays reported sightings on a MapLibre map. The map uses a light raster
 * basemap so the risk-coloured markers stay readable. Camera bounds keep users
 * inside Malaysia, and provider attribution remains visible on every screen.
 */
import { useEffect, useRef } from 'react'
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
import { MapFilters } from './MapFilters'

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

/** Carto supplies raster tiles made from OpenStreetMap data. Raster tiles are
 *  used because the development mock service worker can interfere with
 *  MapLibre's separate vector-tile worker. The attribution text below is kept
 *  visible to meet the OpenStreetMap and Carto licence requirements. */
const STYLE_URL: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'carto-positron': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [{ id: 'basemap', type: 'raster', source: 'carto-positron' }],
}

export function ThreatMapPage() {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<Map | null>(null)
  const markers = useRef<Marker[]>([])
  const isDesktop = useIsDesktop()
  const { species, statuses, risks, search, select } = useMapStore()

  const { data } = useQuery({
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
    m.addControl(new maplibregl.AttributionControl({
      compact: false,
      customAttribution: '© <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · ODbL · © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
    }), 'bottom-right')
    m.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right')
    m.addControl(new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      showUserLocation: true, trackUserLocation: false,
    }), 'top-right')
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

  return (
    <div style={{
      position: 'relative', height: '100%', minHeight: 0,
      display: 'flex', flexDirection: 'column',
    }}>
      <MapFilters />
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={container} style={{
          position: 'absolute', inset: 0,
          touchAction: 'none',   // MapLibre handles pinch, drag, and tap gestures.
        }} />
        <MapLegend />
      </div>
      <SightingDetailsSheet />
    </div>
  )
}

/**
 * Build a DOM element for a sighting marker. Colour by risk, ring by status.
 * The marker is a "teardrop" so it points at the exact coordinate rather than
 * hovering ambiguously nearby.
 */
function pinElement(s: Sighting): HTMLElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.setAttribute('aria-label', `${s.speciesName} — ${s.status}`)
  el.dataset.sightingId = s.id
  el.className = 'map-pin'
  const colour = s.risk === 'high' ? '#C2412D' : '#D9880F'
  const isRemoved = s.status === 'removed'
  const fill = isRemoved ? '#8B978F' : colour
  el.innerHTML = `
    <svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3));">
      <path d="M13 33 C 13 33 24 20 24 11 A 11 11 0 1 0 2 11 C 2 20 13 33 13 33 Z"
            fill="${fill}" stroke="#fff" stroke-width="2" />
      <circle cx="13" cy="11" r="4.5" fill="#fff" opacity="${isRemoved ? 0.6 : 0.9}" />
    </svg>`
  el.style.cssText = `
    width: 26px; height: 34px; padding: 0; background: transparent;
    border: none; cursor: pointer; opacity: ${isRemoved ? 0.7 : 1};
    -webkit-tap-highlight-color: transparent;
  `
  return el
}
