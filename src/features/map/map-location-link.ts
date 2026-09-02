import type { GeoPoint } from '@/types'

export interface MapLocationTarget {
  point: GeoPoint
  label: string
  details?: MapLocationDetails
}

export interface MapLocationDetails {
  kind: 'scan' | 'report'
  statusLabel: string
  observedAt: string
  locationAccuracyM: number | null
  recordId?: string
}

export interface MapLocationNavigationState {
  mapLocation: MapLocationTarget
}

const MALAYSIA_BOUNDS = {
  minLat: 0.8,
  maxLat: 7.5,
  minLng: 99.3,
  maxLng: 119.5,
}

export function mapStateForLocation(
  point: GeoPoint,
  label: string,
  details?: MapLocationDetails,
): MapLocationNavigationState {
  return {
    mapLocation: {
      point,
      label: label.trim().slice(0, 80) || 'Saved record location',
      ...(details ? { details } : {}),
    },
  }
}

export function parseMapLocationTarget(state: unknown): MapLocationTarget | null {
  if (!state || typeof state !== 'object') return null
  const candidate = (state as Partial<MapLocationNavigationState>).mapLocation
  if (!candidate || typeof candidate !== 'object' || !candidate.point) return null
  const lat = Number(candidate.point.lat)
  const lng = Number(candidate.point.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (
    lat < MALAYSIA_BOUNDS.minLat || lat > MALAYSIA_BOUNDS.maxLat
    || lng < MALAYSIA_BOUNDS.minLng || lng > MALAYSIA_BOUNDS.maxLng
  ) return null

  const details = parseDetails(candidate.details)
  return {
    point: { lat, lng },
    label: typeof candidate.label === 'string'
      ? candidate.label.trim().slice(0, 80) || 'Saved record location'
      : 'Saved record location',
    ...(details ? { details } : {}),
  }
}

function parseDetails(value: unknown): MapLocationDetails | null {
  if (!value || typeof value !== 'object') return null
  const details = value as Partial<MapLocationDetails>
  if (details.kind !== 'scan' && details.kind !== 'report') return null
  if (typeof details.statusLabel !== 'string' || !details.statusLabel.trim()) return null
  if (typeof details.observedAt !== 'string' || Number.isNaN(Date.parse(details.observedAt))) return null
  const accuracy = details.locationAccuracyM
  if (accuracy !== null && (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0)) {
    return null
  }
  const recordId = typeof details.recordId === 'string'
    ? details.recordId.trim().slice(0, 128)
    : ''

  return {
    kind: details.kind,
    statusLabel: details.statusLabel.trim().slice(0, 80),
    observedAt: details.observedAt,
    locationAccuracyM: accuracy,
    ...(recordId ? { recordId } : {}),
  }
}
