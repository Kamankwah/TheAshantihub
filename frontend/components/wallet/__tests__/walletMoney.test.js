import { describe, expect, it } from 'vitest'
import { formatGhs, signedGhs } from '../walletMoney.js'

describe('walletMoney signs', () => {
  it('test_signedGhs_puts_the_minus_before_the_currency', () => {
    expect(signedGhs('-5.00')).toBe('−GH₵ 5.00')
    expect(signedGhs('5.00')).toBe('GH₵ 5.00')
    expect(signedGhs('0.00')).toBe('GH₵ 0.00')
  })

  it('test_formatGhs_is_unchanged_for_a_negative', () => {
    expect(formatGhs('-5.00')).toBe('-GH₵ 5.00')
  })
})
