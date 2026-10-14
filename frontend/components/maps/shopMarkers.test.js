import { describe, expect, it } from 'vitest'
import { shopMarkers, unpinnedShops } from './shopMarkers.js'

const S = (sequence, status, lat = 6.7 + sequence / 100) => ({ id: sequence, sequence, name: `Shop ${sequence}`, lat, lng: -1.62, status })

describe('shopMarkers', () => {
  it('draws the shop being worked in gold, later open shops ringed, and no finished shop', () => {
    const got = shopMarkers({ pickups: [S(1, 'collected'), S(2, 'arrived'), S(3, 'pending'), S(4, 'skipped')] })
    expect(got.map((m) => [m.id, m.kind])).toEqual([['stop-2', 'pickup'], ['stop-3', 'stop']])
    expect(got[0].label).toBe('2. Shop 2')
  })
  it('keeps the current shop current even when it has no pin', () => {
    const got = shopMarkers({ pickups: [S(1, 'pending', null), S(2, 'pending')] })
    expect(got.map((m) => m.kind)).toEqual(['stop'])
    expect(unpinnedShops({ pickups: [S(1, 'pending', null), S(2, 'pending')] })).toEqual(['Shop 1'])
  })
  it('one shop is the old single pin, and none without coordinates', () => {
    expect(shopMarkers({ pickup: { lat: 6.7, lng: -1.62, name: 'Kente House' }, pickups: [] })).toEqual([{ id: 'pickup', kind: 'pickup', lat: 6.7, lng: -1.62, label: 'Kente House' }])
    expect(shopMarkers({ pickup: null })).toEqual([])
  })
})
