/** Phase 11B - Historical Records opt-in map layer.
 *
 *  Renders cleaned GBIF occurrences as a **separate** MapLibre GeoJSON
 *  source distinct from the sightings source. Off by default; a legend
 *  toggle in ThreatMapPage flips the ``enabled`` prop. When enabled the
 *  layer fetches the current viewport bbox and paints points as small
 *  diamonds with a colour and shape different from any live sighting
 *  pin - historical evidence must never read as a live census
 *  (AC 5.1.6 spirit + honest-copy requirement of AC 5.1.7).
 */
import { useEffect, useRef } from 'react'
import type {
  GeoJSONSource,
  LayerSpecification,
  Map as MaplibreMap,
  MapGeoJSONFeature,
  MapMouseEvent,
} from 'maplibre-gl'

import {
  useHistoricalOccurrences,
  type HistoricalOccurrence,
} from '@/services/historical-occurrences'

export const HISTORICAL_SOURCE_ID = 'historical-occurrences'
export const HISTORICAL_LAYER_ID = 'historical-occurrences-points'
const HISTORICAL_ICON_ID = 'historical-diamond'

/** Diamond sprite so this layer is visually distinct from the circular
 *  sighting pins even for viewers with colour-vision deficiency.
 *  AC 7.2.1 spirit - shape carries the distinction, colour is secondary.
 */
function buildDiamondImage(pixelRatio: number): ImageData | null {
  if (typeof document === 'undefined') return null
  const size = Math.round(20 * pixelRatio)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, size, size)
  const cx = size / 2
  const cy = size / 2
  const half = size * 0.42
  ctx.beginPath()
  ctx.moveTo(cx, cy - half)
  ctx.lineTo(cx + half, cy)
  ctx.lineTo(cx, cy + half)
  ctx.lineTo(cx - half, cy)
  ctx.closePath()
  ctx.fillStyle = '#6a4baa'
  ctx.globalAlpha = 0.88
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.lineWidth = Math.max(1, 1.5 * pixelRatio)
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  return ctx.getImageData(0, 0, size, size)
}

export function occurrencesToFeatureCollection(
  items: HistoricalOccurrence[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: items.map((o) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [o.longitude, o.latitude] },
      properties: {
        id: o.id,
        species_id: o.speciesId,
        scientific_name: o.scientificName,
        common_name: o.commonName,
        event_year: o.eventYear,
        record_uid: o.recordUid,
        source_url: o.sourceUrl,
        dataset_name: o.datasetName,
        licence: o.licence,
      },
    })),
  }
}

export function buildHistoricalLayerSpec(): LayerSpecification {
  return {
    id: HISTORICAL_LAYER_ID,
    type: 'symbol',
    source: HISTORICAL_SOURCE_ID,
    layout: {
      'icon-image': HISTORICAL_ICON_ID,
      'icon-size': 0.9,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  }
}

type Props = {
  map: MaplibreMap | null
  viewportBbox: [number, number, number, number] | null
  enabled: boolean
  speciesId?: string | null
  onSelect?: (occurrence: HistoricalOccurrence) => void
  onCountChange?: (count: number | null) => void
}

export function HistoricalRecordsLayer({
  map,
  viewportBbox,
  enabled,
  speciesId,
  onSelect,
  onCountChange,
}: Props) {
  const { data } = useHistoricalOccurrences(
    {
      bbox: viewportBbox,
      speciesId: speciesId ?? null,
      limit: 1000,
    },
    enabled && viewportBbox !== null,
  )
  const installedRef = useRef(false)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const dataByIdRef = useRef<Map<string, HistoricalOccurrence>>(new Map())
  dataByIdRef.current = new Map((data?.items ?? []).map((o) => [o.id, o]))

  useEffect(() => {
    if (!map) return
    if (!enabled) {
      if (installedRef.current) {
        if (map.getLayer(HISTORICAL_LAYER_ID)) map.removeLayer(HISTORICAL_LAYER_ID)
        if (map.getSource(HISTORICAL_SOURCE_ID)) map.removeSource(HISTORICAL_SOURCE_ID)
        installedRef.current = false
      }
      return
    }

    let cancelled = false
    const install = () => {
      if (cancelled || !map || installedRef.current) return
      if (!map.isStyleLoaded()) {
        map.once('style.load', install)
        return
      }

      if (!map.hasImage(HISTORICAL_ICON_ID)) {
        const img = buildDiamondImage(window.devicePixelRatio || 1)
        if (img) {
          map.addImage(HISTORICAL_ICON_ID, img, {
            pixelRatio: window.devicePixelRatio || 1,
          })
        }
      }

      if (!map.getSource(HISTORICAL_SOURCE_ID)) {
        map.addSource(HISTORICAL_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
      }
      if (!map.getLayer(HISTORICAL_LAYER_ID)) {
        // Render historical diamonds ABOVE every sightings layer so a
        // dense cluster does not hide them - the whole point of turning
        // the layer on is to see them.
        map.addLayer(buildHistoricalLayerSpec())
      }

      const handleClick = (
        e: MapMouseEvent & { features?: MapGeoJSONFeature[] },
      ) => {
        const feature = e.features?.[0]
        const id = feature?.properties?.id
        if (typeof id !== 'string') return
        const occurrence = dataByIdRef.current.get(id)
        if (occurrence && onSelectRef.current) onSelectRef.current(occurrence)
      }
      const setPointer = () => {
        map.getCanvas().style.cursor = 'pointer'
      }
      const clearPointer = () => {
        map.getCanvas().style.cursor = ''
      }
      map.on('click', HISTORICAL_LAYER_ID, handleClick)
      map.on('mouseenter', HISTORICAL_LAYER_ID, setPointer)
      map.on('mouseleave', HISTORICAL_LAYER_ID, clearPointer)
      installedRef.current = true
    }

    install()

    return () => {
      cancelled = true
      if (!map) return
      if (map.getLayer(HISTORICAL_LAYER_ID)) map.removeLayer(HISTORICAL_LAYER_ID)
      if (map.getSource(HISTORICAL_SOURCE_ID)) map.removeSource(HISTORICAL_SOURCE_ID)
      installedRef.current = false
    }
  }, [map, enabled])

  useEffect(() => {
    if (!map || !installedRef.current || !data) return
    const source = map.getSource(HISTORICAL_SOURCE_ID) as GeoJSONSource | undefined
    source?.setData(occurrencesToFeatureCollection(data.items))
  }, [map, data])

  // Surface the visible-viewport count so the toggle button can render it
  // and tell the user whether "no diamonds visible" means the layer failed
  // to install or just that the current bbox has zero historical records.
  useEffect(() => {
    if (!onCountChange) return
    if (!enabled) {
      onCountChange(null)
      return
    }
    if (data) onCountChange(data.items.length)
  }, [enabled, data, onCountChange])

  return null
}
