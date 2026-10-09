import { describe, expect, it } from 'vitest'
import { distanceM, formatDistance } from '../geo.js'

describe('geo', () => {
  it('measures a degree of latitude as about 111 km', () => {
    expect(distanceM(6, 0, 7, 0)).toBeGreaterThan(111000)
    expect(distanceM(6, 0, 7, 0)).toBeLessThan(111400)
  })
  it('is zero for the same point', () => {
    expect(distanceM(6.6885, -1.6244, 6.6885, -1.6244)).toBe(0)
  })
  it('formats metres below a kilometre and kilometres above', () => {
    expect(formatDistance(38.4)).toBe('38 m')
    expect(formatDistance(1234)).toBe('1.2 km')
    expect(formatDistance(null)).toBe('')
  })
})
