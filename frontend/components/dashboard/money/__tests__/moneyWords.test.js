import { describe, expect, it } from 'vitest'
import { D } from '../../theme.js'
import { SALE_FILTERS, TEXT_KIND_WORDS, releaseLine, statusColor, textKindWord } from '../moneyWords.js'

describe('moneyWords', () => {
  it('test_text_kinds_use_the_servers_words_and_unknown_reads_money_text', () => {
    expect(TEXT_KIND_WORDS).toEqual({
      order_paid: 'Order paid', order_released: 'Order released', daily_digest: 'Daily digest', refund: 'Refund',
      withdrawal: 'Withdrawal', balance_negative: 'Balance below zero', balance_low: 'Balance low',
      booking_paid: 'Booking paid', booking_released: 'Booking released', booking_on_hold: 'Booking on hold',
    })
    expect(textKindWord('booking_on_hold')).toBe('Booking on hold')
    expect(textKindWord('mystery')).toBe('Money text')
    expect(textKindWord(undefined)).toBe('Money text')
  })

  it('test_sale_filters_and_status_colours', () => {
    expect(SALE_FILTERS).toEqual([
      { value: 'all', label: 'All' }, { value: 'awaiting_call', label: 'Waiting' },
      { value: 'released', label: 'Released' }, { value: 'refunded', label: 'Refunded' },
    ])
    expect(statusColor({ status: 'released' })).toBe(D.green)
    expect(statusColor({ status: 'refunded' })).toBe(D.textDim)
    expect(statusColor({ status: 'awaiting_call' })).toBe(D.amber)
    expect(statusColor({ status: 'on_hold' })).toBe(D.amber)
  })

  it('test_releaseLine_formats_in_accra_and_is_null_without_a_time', () => {
    expect(releaseLine({ release_at: '2026-10-22T14:00:00Z' })).toBe('Releases automatically from Thu 22 Oct, 14:00')
    expect(releaseLine({ release_at: null })).toBeNull()
    expect(releaseLine({})).toBeNull()
  })
})
