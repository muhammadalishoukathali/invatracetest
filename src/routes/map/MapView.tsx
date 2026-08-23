/**
 * Threat map (Arch §4.1). MapLibre GL over OpenFreeMap "positron"-style vector
 * tiles — a light, low-noise base that keeps invasive-pin colours readable.
 * ODbL attribution stays open at every zoom level (compact:false).
 *
 * Panning is confined to Malaysia so the map does not wander to random parts
 * of the world; this matches Iteration 1's scope (Peninsular Malaysia field
 * trials centred on Bukit Kiara).
 */
import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as maplibregl from 'maplibre-gl'
import type { Map, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import { api } from '@/lib/api'
import { useIsDesktop } from '@/lib/useIsDesktop'
import { useMap as useMapStore } from '@/lib/map-store'
import type { Sighting } from '@/types'
import { PinSheet } from './PinSheet'
import { Legend } from './Legend'
import { Filters } from './Filters'

const CENTRE: [number, number] = [101.6412, 3.1497]  // Bukit Kiara
const INITIAL_ZOOM = 13.5
const INITIAL_ZOOM_MOBILE = 13

/* Rough bounding box for all of Malaysia (west Sarawak to Sabah, north to
   Perlis). Users can zoom and pan freely inside; the camera will not drift
   into Thailand, Indonesia or the open sea. */
const MY_BOUNDS: [[number, number], [number, number]] = [
  [99.3, 0.8],   // SW: south of Kudat, west of Langkawi
  [119.5, 7.5],  // NE: east of Sabah, north of Perlis
]

/* Carto Positron raster tiles — OSM data (ODbL) rendered by Carto, CORS
 * enabled, no API key. Chosen because MSW's dev service worker interferes
 * with MapLibre's vector-tile worker path; raster tiles are decoded on the
 * main thread and sidestep the issue entirely.
 * Attribution: "© OpenStreetMap contributors © CARTO" per Carto's TOS. */
const STYLE_URL: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
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

export function MapView() {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<Map | null>(null)
  const markers = useRef<Marker[]>([])
  const isDesktop = useIsDesktop()
  const { species, statuses, search, select } = useMapStore()

  const { data } = useQuery({
    queryKey: ['sightings'],
    queryFn: () => api<{ items: Sighting[] }>('/api/v1/sightings'),
    staleTime: 60_000,
  })

  /* Init map once — recreated only if the desktop breakpoint flips. */
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
      dragRotate: false,          // simpler two-finger UX on phones
      touchZoomRotate: true,
      touchPitch: false,
    })
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

    /* Kick tile requests once style parses. Without this nudge, MapLibre v6
     *  sits at "style parsed but no tiles requested" — resizing alone is not
     *  enough; a fresh jumpTo forces the source manager to compute a viewport
     *  and request the covering tiles. */
    m.once('style.load', () => {
      m.resize()
      m.jumpTo({ center: CENTRE, zoom: isDesktop ? INITIAL_ZOOM : INITIAL_ZOOM_MOBILE })
    })

    /* Container may size after mount (auth shell renders, then main flexes to
       full height); keep the canvas in sync via ResizeObserver. */
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(container.current)

    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Re-render pins whenever data or filters change. */
  useEffect(() => {
    if (!map.current || !data) return

    markers.current.forEach((m) => m.remove())
    markers.current = []

    const q = search.trim().toLowerCase()
    const filtered = data.items.filter((s) => {
      if (species.length && !species.includes(s.speciesId)) return false
      if (statuses.length && !statuses.includes(s.status)) return false
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
  }, [data, species, statuses, search, select])

  return (
    <div style={{
      position: 'relative', height: '100%', minHeight: 0,
      display: 'flex', flexDirection: 'column',
    }}>
      <Filters />
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={container} style={{
          position: 'absolute', inset: 0,
          touchAction: 'none',   // let MapLibre own all touch gestures
        }} />
        <Legend />
      </div>
      <PinSheet />
    </div>
  )
}

/**
 * Build a DOM element for a sighting marker. Colour by risk, ring by status.
 * A dashed ring signals a candidate sighting (reduced-precision pin).
 * The marker is a "teardrop" so it points at the exact coordinate rather than
 * hovering ambiguously nearby.
 */
function pinElement(s: Sighting): HTMLElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.setAttribute('aria-label', `${s.speciesName} — ${s.status}`)
  el.className = 'map-pin'
  const colour = s.risk === 'high' ? '#C2412D' : '#D9880F'
  const isCandidate = s.status === 'candidate'
  const isRemoved = s.status === 'removed'
  const fill = isRemoved ? '#8B978F' : colour
  const strokeDash = isCandidate ? 'stroke-dasharray="3 2.5"' : ''
  el.innerHTML = `
    <svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3));">
      <path d="M13 33 C 13 33 24 20 24 11 A 11 11 0 1 0 2 11 C 2 20 13 33 13 33 Z"
            fill="${fill}" stroke="#fff" stroke-width="2" ${strokeDash} />
      <circle cx="13" cy="11" r="4.5" fill="#fff" opacity="${isRemoved ? 0.6 : 0.9}" />
    </svg>`
  el.style.cssText = `
    width: 26px; height: 34px; padding: 0; background: transparent;
    border: none; cursor: pointer; opacity: ${isRemoved ? 0.7 : 1};
    -webkit-tap-highlight-color: transparent;
  `
  return el
}
