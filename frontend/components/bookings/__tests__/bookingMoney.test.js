import { describe, it, expect } from 'vitest'
import { payeeWord, moneyLines, policyLines, policyLabel, groupTicketsByPurchase } from '../bookingMoney.js'

const NOW = new Date('2026-11-10T12:00:00Z')
const base = {
  sale: 1, release_at: null, released_at: null, accepted_at: null, refunded: null, refunded_whole: false,
  problem: null, policy: null, start: null, can_cancel: false, can_report: false, cancelled_by_you: false,
}
const m = (over) => ({ ...base, ...over })

describe('bookingMoney', () => {
  it('names the payee per kind', () => {
    expect(payeeWord('service')).toBe('business')
    expect(payeeWord('stay')).toBe('host')
    expect(payeeWord('tickets')).toBe('organiser')
  })

  it('writes the whole-refund and part-refund lines from the server amount', () => {
    expect(moneyLines(m({ refunded: '150.00', refunded_whole: true }), 'stay', NOW)[0])
      .toBe('Refunded in full: GH₵ 150.00 went back to your AshantiHub wallet.')
    const part = moneyLines(m({ refunded: '75.00', cancelled_by_you: true, release_at: '2026-11-20T10:00:00Z' }), 'stay', NOW)
    expect(part[0]).toBe('GH₵ 75.00 went back to your AshantiHub wallet.')
    expect(part[1]).toBe('The host keeps the rest under the cancellation policy.')
  })

  it('does not say the host keeps the rest after a refund the customer did not make', () => {
    const lines = moneyLines(m({ refunded: '50.00', release_at: '2026-11-20T10:00:00Z', can_report: true }), 'tickets', NOW)
    expect(lines).toEqual([
      'GH₵ 50.00 went back to your AshantiHub wallet.',
      'The organiser is paid on Fri 20 Nov, 10:00 unless you report a problem before then.',
    ])
    expect(lines.join(' ')).not.toMatch(/keeps the rest/)
  })

  it('drops the report clause once Support closed the problem or Report is not offered', () => {
    expect(moneyLines(m({ problem: 'closed', release_at: '2026-11-20T10:00:00Z' }), 'stay', NOW)[1])
      .toBe('The host is paid on Fri 20 Nov, 10:00.')
    expect(moneyLines(m({ problem: 'closed', release_at: '2026-11-20T10:00:00Z' }), 'service', NOW)[1])
      .toBe('Accepts automatically on Fri 20 Nov, 10:00.')
    expect(moneyLines(m({ can_report: false, release_at: '2026-11-20T10:00:00Z' }), 'tickets', NOW))
      .toEqual(['The organiser is paid on Fri 20 Nov, 10:00.'])
  })

  it('stops at the on-hold line while a problem is open', () => {
    expect(moneyLines(m({ problem: 'open', release_at: '2026-11-20T10:00:00Z' }), 'tickets', NOW)).toEqual([
      'Problem reported. Support is looking into it, and the payment to the organiser is on hold until it is settled.',
    ])
  })

  it('says a closed problem was settled', () => {
    const lines = moneyLines(m({ problem: 'closed', released_at: '2026-11-11T09:30:00Z' }), 'stay', NOW)
    expect(lines[0]).toBe('Support has settled the problem you reported.')
    expect(lines[1]).toBe('The host was paid on Wed 11 Nov, 09:30.')
  })

  it('tells an accepted service from one paid on the timer', () => {
    expect(moneyLines(m({ released_at: '2026-11-11T09:30:00Z', accepted_at: '2026-11-10T08:00:00Z' }), 'service', NOW))
      .toEqual(['You accepted this on Tue 10 Nov, 08:00. The business has been paid.'])
    expect(moneyLines(m({ released_at: '2026-11-11T09:30:00Z' }), 'service', NOW))
      .toEqual(['The business was paid on Wed 11 Nov, 09:30.'])
  })

  it('reads due now for a release time in the past', () => {
    expect(moneyLines(m({ release_at: '2026-11-10T11:00:00Z' }), 'tickets', NOW))
      .toEqual(['The organiser is due to be paid now.'])
  })

  it('keeps the service auto-accept wording', () => {
    expect(moneyLines(m({ release_at: '2026-11-12T10:00:00Z', can_report: true }), 'service', NOW))
      .toEqual(['Accepts automatically on Thu 12 Nov, 10:00 unless you report a problem.'])
    expect(moneyLines(m({ release_at: '2026-11-12T10:00:00Z', start: '2026-11-15T10:00:00Z', can_report: true }), 'stay', NOW))
      .toEqual(['The host is paid on Thu 12 Nov, 10:00 unless you report a problem before then.'])
  })

  it('returns no lines for null or undefined money', () => {
    expect(moneyLines(null, 'stay', NOW)).toEqual([])
    expect(moneyLines(undefined, 'stay', NOW)).toEqual([])
  })

  it('gives a service one full-refund line and a no-refund ticket none', () => {
    const svc = m({ policy: { policy: 'flexible', tiers: [[24, 10000]], text: 't' }, start: null })
    expect(policyLines(svc, NOW)).toEqual(['Full refund any time before the business marks the job done'])
    const tix = m({ policy: { policy: 'none', tiers: [], text: 'No refunds' }, start: '2026-12-01T10:00:00Z' })
    expect(policyLines(tix, NOW)).toEqual([])
    const stay = m({ policy: { policy: 'flexible', tiers: [[24, 10000]], text: 't' }, start: '2026-11-15T14:00:00Z' })
    expect(policyLines(stay, NOW)).toEqual(['Free cancellation until Sat 14 Nov, 14:00'])
  })

  it('labels only the three named policies', () => {
    const terms = { policies: { flexible: { label: 'Flexible' }, moderate: { label: 'Moderate' }, strict: { label: 'Strict' } } }
    expect(policyLabel({ policy: 'flexible' }, terms)).toBe('Flexible')
    expect(policyLabel({ policy: 'organiser' }, terms)).toBeNull()
    expect(policyLabel({ policy: 'none' }, terms)).toBeNull()
    expect(policyLabel({ policy: 'strict' }, undefined)).toBeNull()
  })

  it('groups tickets by purchase in first-seen order', () => {
    const t = [
      { id: 1, money: { sale: 9 } }, { id: 2, money: { sale: 7 } }, { id: 3 }, { id: 4, money: { sale: 9 } },
    ]
    const g = groupTicketsByPurchase(t)
    expect(g.map((x) => x.key)).toEqual(['sale-9', 'sale-7', 'ticket-3'])
    expect(g[0].tickets.map((x) => x.id)).toEqual([1, 4])
    expect(g[0].money).toEqual({ sale: 9 })
    expect(g[2].money).toBeNull()
  })
})
