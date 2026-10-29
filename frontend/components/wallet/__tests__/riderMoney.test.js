import { afterEach, describe, expect, it } from 'vitest'
import { accraWhen, isBelowZero, percentFromBp } from '../riderMoney.js'
import { formatGhs, signedGhs } from '../walletMoney.js'

describe('percentFromBp', () => {
  it.each([[1000, '10%'], [1050, '10.5%'], [1234, '12.34%'], [0, '0%'], [10000, '100%']])('%s is %s', (bp, text) => {
    expect(percentFromBp(bp)).toBe(text)
  })
})

describe('isBelowZero', () => {
  it('is true only for a leading minus', () => {
    expect(isBelowZero('-0.01')).toBe(true)
    expect(isBelowZero('0.00')).toBe(false)
    expect(isBelowZero('13.50')).toBe(false)
  })
})

describe('accraWhen', () => {
  const originalTz = process.env.TZ
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  it('writes the time in Accra time', () => {
    expect(accraWhen('2026-10-21T00:00:00Z')).toBe('00:00 on Wed 21 Oct (Accra time)')
  })

  it('ignores the device time zone', () => {
    process.env.TZ = 'Pacific/Auckland'
    expect(accraWhen('2026-10-21T00:00:00Z')).toBe('00:00 on Wed 21 Oct (Accra time)')
  })
})

describe('signedGhs and formatGhs', () => {
  it('shows a negative with the real minus sign', () => {
    expect(signedGhs('-13.50')).toBe('−GH₵ 13.50')
  })
  it('leaves other values as formatGhs writes them', () => {
    expect(signedGhs('13.50')).toBe('GH₵ 13.50')
    expect(signedGhs('0.00')).toBe('GH₵ 0.00')
  })
  it('pins formatGhs at the edges', () => {
    expect(formatGhs('99999999.99')).toBe('GH₵ 99,999,999.99')
    expect(formatGhs('-5.00')).toBe('-GH₵ 5.00')
  })
})
