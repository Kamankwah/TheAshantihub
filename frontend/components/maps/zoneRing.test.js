import { describe, expect, it } from 'vitest'
import { latLngsFromRing, ringFromLatLngs } from './zoneRing.js'

describe('ringFromLatLngs', () => {
  it('swaps Leaflet [lat, lng] / {lat, lng} points into an open [lng, lat] ring', () => {
    expect(ringFromLatLngs([{ lat: 6.69, lng: -1.62 }, { lat: 6.69, lng: -1.6 }, { lat: 6.71, lng: -1.61 }]))
      .toEqual([[-1.62, 6.69], [-1.6, 6.69], [-1.61, 6.71]])
    expect(ringFromLatLngs([[6.69, -1.62], [6.69, -1.6], [6.71, -1.61]])).toEqual([[-1.62, 6.69], [-1.6, 6.69], [-1.61, 6.71]])
  })
  it('drops a repeated closing point (the backend ring is open)', () => {
    expect(ringFromLatLngs([[6.69, -1.62], [6.69, -1.6], [6.71, -1.61], [6.69, -1.62]])).toHaveLength(3)
  })
  it('returns null for fewer than 3 distinct points or bad input', () => {
    expect(ringFromLatLngs([[6.69, -1.62], [6.69, -1.6], [6.69, -1.62]])).toBeNull()
    expect(ringFromLatLngs([])).toBeNull()
    expect(ringFromLatLngs(null)).toBeNull()
    expect(ringFromLatLngs([[NaN, 1], [2, 3], [4, 5]])).toBeNull()
  })
})

describe('latLngsFromRing', () => {
  it('swaps [lng, lat] into [lat, lng]', () => {
    expect(latLngsFromRing([[-1.62, 6.69], [-1.6, 6.69], [-1.61, 6.71]])).toEqual([[6.69, -1.62], [6.69, -1.6], [6.71, -1.61]])
  })
  it('drops a duplicate closing point', () => {
    expect(latLngsFromRing([[-1.62, 6.69], [-1.6, 6.69], [-1.61, 6.71], [-1.62, 6.69]])).toHaveLength(3)
  })
  it('gives [] for null, short or invalid rings', () => {
    expect(latLngsFromRing(null)).toEqual([])
    expect(latLngsFromRing([[1, 2], [3, 4]])).toEqual([])
    expect(latLngsFromRing([[1, 2], ['a', 4], [5, 6]])).toEqual([])
  })
})
