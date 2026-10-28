import { describe, expect, it } from 'vitest'
import { lineTotalGhs } from '../bookingPay.js'

describe('lineTotalGhs', () => {
  it('line totals use whole pesewas', () => {
    expect(lineTotalGhs('80.00', 3)).toBe('240.00')
    expect(lineTotalGhs('0.10', 3)).toBe('0.30')
    expect(lineTotalGhs('99999.99', 10)).toBe('999999.90')
    expect(lineTotalGhs('x', 2)).toBeNull()
  })
})
