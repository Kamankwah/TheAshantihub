import { describe, expect, it } from 'vitest'
import { coverSentence, displayBarcode, formatPrice, isGoodsCategory } from '../catalogueFormat.js'

describe('catalogueFormat', () => {
  it('test_displayBarcode_shows_the_shortest_standard_length', () => {
    expect(displayBarcode('00036000291452')).toBe('036000291452')
    expect(displayBarcode('05000112548167')).toBe('5000112548167')
    expect(displayBarcode('00000096385074')).toBe('96385074')
    expect(displayBarcode('00000001234565')).toBe('01234565')
    expect(displayBarcode('10012345678902')).toBe('10012345678902')
    expect(displayBarcode('')).toBe('')
  })

  it('test_isGoodsCategory_mirrors_the_cart_guard', () => {
    expect(isGoodsCategory({ kind: 'product', is_food: false, is_accommodation: false })).toBe(true)
    expect(isGoodsCategory({ kind: 'service', is_food: true, is_accommodation: false })).toBe(true)
    expect(isGoodsCategory({ kind: 'product', is_food: false, is_accommodation: true })).toBe(false)
    expect(isGoodsCategory({ kind: 'service', is_food: false, is_accommodation: false })).toBe(false)
    expect(isGoodsCategory({ kind: 'event', is_food: false, is_accommodation: false })).toBe(false)
  })

  it('test_coverSentence_per_basis', () => {
    expect(coverSentence({ sold_out: true })).toBe('Sold out.')
    expect(coverSentence({ basis: 'sales', days_of_cover: 3, units_sold: 12, days_on_sale: 4 })).toBe(
      'About 3 days of sales left: 12 sold in the last 4 day(s).')
    expect(coverSentence({ basis: 'fallback', stock: 2, line: 5 }, { window_days: 28 })).toBe(
      '2 left. No sales in the last 28 days, so it counts as low at 5 or fewer.')
    expect(coverSentence({ basis: 'own_threshold', stock: 4, line: 6 })).toBe('4 left. Your alert line is 6.')
    expect(coverSentence({ basis: 'sales', days_of_cover: 1, units_sold: 1, days_on_sale: 1 })).toContain('About 1 days')
  })

  it('test_formatPrice_never_uses_float_maths', () => {
    expect(formatPrice('1250.00')).toBe('GH₵ 1,250.00')
    expect(formatPrice('0.50')).toBe('GH₵ 0.50')
    expect(formatPrice('99999999.99')).toBe('GH₵ 99,999,999.99')
  })
})
