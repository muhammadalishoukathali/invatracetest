/** Wave 2c — direction-aware place overlay for ThreatMapPage.
 *
 *  Fetches places for the current viewport bbox and paints three layers
 *  (park/forest fill + outline, plus a trail line layer) BELOW the
 *  sightings pins so a sighting click always wins on top-layer query.
 *  MapLibre owns rendering; this component is just the source-and-layer
 *  installer, cleanup handler, and click bridge into React state.
 */
import { useEffect, useRef } from 'react'
import type {
  GeoJSONSource,
  LayerSpecification,
  Map as MaplibreMap,
  MapGeoJSONFeature,
  MapMouseEvent,
} from 'maplibre-gl'

import { usePlaces, type PlaceListItem } from '@/services/place-discovery'

export const PLACES_SOURCE_ID = 'places'
export const PLACES_PARK_FILL_LAYER_ID = 'places-park-fill'
export const PLACES_PARK_OUTLINE_LAYER_ID = 'places-park-outline'
export const PLACES_TRAIL_LAYER_ID = 'places-trail'
/** Kept in sync with ThreatMapPage's SIGHTINGS layer ids so the place
 *  overlay is guaranteed to sit UNDER the sightings when both are
 *  installed. */
const SIGHTINGS_CLUSTERS_LAYER_ID = 'sightings-clusters'

type PlaceLayerSpec = LayerSpecification

/** Pure builder for the three place layer specs. Extracted so the layer
 *  wiring is unit-testable without spinning up MapLibre in jsdom
 *  (which doesn't work — MapLibre requires a real canvas). */
export function buildPlaceLayerSpecs(): PlaceLayerSpec[] {
  return [
    {
      id: PLACES_PARK_FILL_LAYER_ID,
      type: 'fill',
      source: PLACES_SOURCE_ID,
      filter: ['in', ['get', 'place_type'], ['literal', ['park', 'forest']]],
      paint: {
        // Deliberately desaturated so places read as background context
        // rather than as an interactive foreground layer. The sighting
        // pins on top carry the vivid tier colours.
        'fill-color': '#7a9c85',
        'fill-opacity': 0.18,
      },
    },
    {
      id: PLACES_PARK_OUTLINE_LAYER_ID,
      type: 'line',
      source: PLACES_SOURCE_ID,
      filter: ['in', ['get', 'place_type'], ['literal', ['park', 'forest']]],
      paint: {
        'line-color': '#4b6b58',
        'line-width': 1.25,
        'line-opacity': 0.7,
      },
    },
    {
      id: PLACES_TRAIL_LAYER_ID,
      type: 'line',
      source: PLACES_SOURCE_ID,
      filter: ['==', ['get', 'place_type'], 'trail'],
      paint: {
        'line-color': '#8a5a2b',
        'line-width': 2,
        'line-dasharray': [2, 1],
        'line-opacity': 0.85,
      },
    },
  ]
}

/** Turn the place-list API response into a FeatureCollection the
 *  MapLibre GeoJSON source can consume. */
export function placesToFeatureCollection(
  items: PlaceListItem[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: items.map((place) => ({
      type: 'Feature',
      geometry: place.geometrySimplified,
      properties: {
        place_id: place.placeId,
        place_type: place.placeType,
        display_name: place.displayName,
      },
    })),
  }
}

type Props = {
  map: MaplibreMap | null
  viewport: { bbox: [number, number, number, number] } | null
  onPlaceClick: (placeId: string) => void
}

export function PlaceLayer({ map, viewport, onPlaceClick }: Props) {
  const { data } = usePlaces({ bbox: viewport?.bbox })
  const installedRef = useRef(false)
  const onClickRef = useRef(onPlaceClick)
  onClickRef.current = onPlaceClick

  useEffect(() => {
    if (!map) return
    let cancelled = false

    const install = () => {
      if (cancelled || !map || installedRef.current) return
      // If MapLibre's style hasn't finished loading, defer.
      if (!map.isStyleLoaded()) {
        map.once('style.load', install)
        return
      }

      if (!map.getSource(PLACES_SOURCE_ID)) {
        map.addSource(PLACES_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
      }

      const specs = buildPlaceLayerSpecs()
      // Anchor beneath the sightings cluster layer if present so a
      // sighting pin click always wins over the underlying place polygon.
      const beforeId = map.getLayer(SIGHTINGS_CLUSTERS_LAYER_ID)
        ? SIGHTINGS_CLUSTERS_LAYER_ID
        : undefined
      for (const spec of specs) {
        if (!map.getLayer(spec.id)) {
          map.addLayer(spec, beforeId)
        }
      }

      const handleClick = (event: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
        const feature = event.features?.[0]
        const placeId = feature?.properties?.place_id
        if (typeof placeId === 'string') onClickRef.current(placeId)
      }
      const setPointer = () => { map.getCanvas().style.cursor = 'pointer' }
      const clearPointer = () => { map.getCanvas().style.cursor = '' }
      for (const layerId of [
        PLACES_PARK_FILL_LAYER_ID,
        PLACES_PARK_OUTLINE_LAYER_ID,
        PLACES_TRAIL_LAYER_ID,
      ]) {
        map.on('click', layerId, handleClick)
        map.on('mouseenter', layerId, setPointer)
        map.on('mouseleave', layerId, clearPointer)
      }
      installedRef.current = true
    }

    install()

    return () => {
      cancelled = true
      if (!map) return
      // Peel off only what we installed — never touch the sighting
      // layers.
      for (const layerId of [
        PLACES_PARK_FILL_LAYER_ID,
        PLACES_PARK_OUTLINE_LAYER_ID,
        PLACES_TRAIL_LAYER_ID,
      ]) {
        if (map.getLayer(layerId)) map.removeLayer(layerId)
      }
      if (map.getSource(PLACES_SOURCE_ID)) map.removeSource(PLACES_SOURCE_ID)
      installedRef.current = false
    }
  }, [map])

  // Push fresh viewport data into the source rather than re-adding it.
  useEffect(() => {
    if (!map || !data || !installedRef.current) return
    const source = map.getSource(PLACES_SOURCE_ID) as GeoJSONSource | undefined
    source?.setData(placesToFeatureCollection(data.items))
  }, [map, data])

  return null
}
