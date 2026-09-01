import { describe, expect, it } from 'vitest'
import { mapStateForLocation, parseMapLocationTarget } from './map-location-link'

describe('map location links', () => {
  it('round-trips a saved scan location and label through navigation state', () => {
    const state = mapStateForLocation({ lat: 3.05936, lng: 101.61481 }, 'Mimosa diplotricha scan')
    expect(parseMapLocationTarget(state)).toEqual({
      point: { lat: 3.05936, lng: 101.61481 },
      label: 'Mimosa diplotricha scan',
    })
  })

  it('rejects missing, invalid, and out-of-Malaysia coordinates', () => {
    expect(parseMapLocationTarget(null)).toBeNull()
    expect(parseMapLocationTarget({ mapLocation: { point: { lat: 'nope', lng: 101.6 } } })).toBeNull()
    expect(parseMapLocationTarget({ mapLocation: { point: { lat: 40, lng: 101.6 } } })).toBeNull()
  })
})
