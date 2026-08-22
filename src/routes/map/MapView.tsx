/**
 * Threat map (Arch §4.1). MapLibre GL over OSM raster tiles. ODbL attribution
 * is always visible (MapLibre's AttributionControl is compact:false so the
 * "© OpenStreetMap contributors" line stays open at all zoom levels).
 *
 * Vector tiles are the eventual target (Arch §3) but need a keyed provider;
 * raster OSM is used here so the demo runs without an external account.
 */
import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as maplibregl from 'maplibre-gl'
import type { Map, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api } from '@/lib/api'
import { useMap as useMapStore } from '@/lib/map-store'
import type { Sighting } from '@/types'
import { PinSheet } from './PinSheet'
import { Legend } from './Legend'
import { Filters } from './Filters'

const CENTRE: [number, number] = [101.6412, 3.1497]  // Bukit Kiara
const INITIAL_ZOOM = 14

/* OpenFreeMap serves OSM vector tiles under an open licence with CORS enabled
   and no API key — matches Arch §3 "vector tiles, ODbL attribution".
   tile.openstreetmap.org blocks cross-origin canvas reads which taints the
   WebGL texture (opaque response → blank map), so it is not usable here. */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

export function MapView() {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<Map | null>(null)
  const markers = useRef<Marker[]>([])
  const { species, statuses, search, select } = useMapStore()

  const { data } = useQuery({
    queryKey: ['sightings'],
    queryFn: () => api<{ items: Sighting[] }>('/api/v1/sightings'),
    staleTime: 60_000,
  })

  /* Init map once. */
  useEffect(() => {
    if (!container.current || map.current) return
    const m = new maplibregl.Map({
      container: container.current,
      style: STYLE_URL,
      center: CENTRE,
      zoom: INITIAL_ZOOM,
      minZoom: 10,
      maxZoom: 19,
      attributionControl: false,
    })
    m.addControl(new maplibregl.AttributionControl({
      compact: false,
      customAttribution: '© <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · ODbL',
    }), 'bottom-right')
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.current = m

    /* Container may size after mount (auth shell renders, then main flexes to
       full height); keep the canvas in sync via ResizeObserver. */
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(container.current)

    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
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
    <div style={{ position: 'relative', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Filters />
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={container} style={{ position: 'absolute', inset: 0 }} />
        <Legend />
      </div>
      <PinSheet />
    </div>
  )
}

/**
 * Build a DOM element for a sighting marker. Colour by risk, ring by status.
 * A dashed ring signals a candidate sighting (reduced-precision pin).
 */
function pinElement(s: Sighting): HTMLElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.setAttribute('aria-label', `${s.speciesName} — ${s.status}`)
  el.className = 'map-pin'
  const colour = s.risk === 'high' ? '#C2412D' : '#D9880F'
  const isCandidate = s.status === 'candidate'
  const isRemoved = s.status === 'removed'
  el.style.cssText = `
    width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
    background: ${isRemoved ? '#8B978F' : colour};
    border: 2px ${isCandidate ? 'dashed #fff' : 'solid #fff'};
    box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    opacity: ${isRemoved ? 0.65 : 1};
    padding: 0;
  `
  return el
}
