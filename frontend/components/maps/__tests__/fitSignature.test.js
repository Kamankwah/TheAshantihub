import { vi } from 'vitest'
import { describe, expect, it } from 'vitest'
// The global setup stubs TrackMap.jsx; load the real module for the pure helper.
const { fitSignature } = await vi.importActual('../TrackMap.jsx')

const base = [
  { id: 'p', kind: 'pickup', lat: 5.6, lng: -0.18, label: 'P' },
  { id: 'd', kind: 'drop', lat: 5.61, lng: -0.17, label: 'D' },
  { id: 'r', kind: 'rider', lat: 5.602, lng: -0.179, label: 'R' },
]
const route = [[5.6, -0.18], [5.605, -0.175], [5.61, -0.17]]

describe('fitSignature', () => {
  it('is the same for the same inputs', () => {
    expect(fitSignature(base, route)).toBe(fitSignature([...base], [...route]))
  })
  it('ignores a rider moving', () => {
    const moved = base.map((m) => (m.kind === 'rider' ? { ...m, lat: 5.608, lng: -0.172 } : m))
    expect(fitSignature(moved, route)).toBe(fitSignature(base, route))
  })
  it('changes when a pickup or drop changes', () => {
    const moved = base.map((m) => (m.kind === 'drop' ? { ...m, lat: 5.7 } : m))
    expect(fitSignature(moved, route)).not.toBe(fitSignature(base, route))
    expect(fitSignature(base.slice(1), route)).not.toBe(fitSignature(base, route))
  })
  it('ignores the route start moving and the route length changing', () => {
    const closer = [[5.608, -0.172], [5.61, -0.17]]
    expect(fitSignature(base, closer)).toBe(fitSignature(base, route))
  })
  it('changes when the route destination changes', () => {
    expect(fitSignature(base, [[5.6, -0.18], [5.62, -0.16]])).not.toBe(fitSignature(base, route))
  })
  it('handles a null route', () => {
    expect(fitSignature(base, null)).not.toBe(fitSignature(base, route))
    expect(fitSignature(base, null)).toBe(fitSignature(base, undefined))
  })
})
