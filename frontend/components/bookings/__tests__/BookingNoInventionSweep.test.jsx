import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import BookingMoneyBar from '../BookingMoneyBar.jsx'
import ServiceAcceptBar from '../../ServiceAcceptBar.jsx'

// Conformance sweep (plan 7G): across every money state, the bars never contact a business, never say "dispute",
// show a GH₵ amount only when the fixture carries it, and render amounts in tabular figures, never gold.

const base = {
  sale: 12, release_at: '2099-10-12T14:00:00Z', released_at: null, accepted_at: null, refunded: null, refunded_whole: false, problem: null,
  policy: { policy: 'moderate', tiers: [[120, 10000], [24, 5000]], text: 'Full refund until 5 days before the start, half until 24 hours before.' },
  start: '2099-10-10T14:00:00Z', can_cancel: true, can_report: true,
}
const STATES = {
  'before start': base,
  'due now': { ...base, release_at: '2020-01-01T00:00:00Z', can_cancel: false },
  'problem open': { ...base, problem: 'open', can_cancel: false, can_report: false },
  'problem closed': { ...base, problem: 'closed', can_cancel: false, can_report: false },
  released: { ...base, released_at: '2026-10-12T14:00:00Z', can_cancel: false, can_report: false },
  accepted: { ...base, released_at: '2026-10-12T14:00:00Z', accepted_at: '2026-10-12T13:00:00Z', can_cancel: false, can_report: false },
  'partial refund': { ...base, refunded: '75.00', refunded_whole: false, can_cancel: false, can_report: false },
  'whole refund': { ...base, refunded: '150.00', refunded_whole: true, can_cancel: false, can_report: false },
  legacy: { ...base, policy: null, can_cancel: false, can_report: false },
  null: null,
}

const FORBIDDEN_TEXT = /message the (host|organiser|business)|call the|open a dispute/i
const GOLD = ['#d4a017', 'rgb(212, 160, 23)', 'rgb(212,160,23)']

function sweep(container, money) {
  expect(container.querySelectorAll('a[href^="tel:"]')).toHaveLength(0)
  expect(container.querySelectorAll('a[href*="wa.me"]')).toHaveLength(0)
  const text = container.textContent
  expect(text).not.toMatch(/wa\.me/)
  expect(text).not.toMatch(FORBIDDEN_TEXT)
  expect(text).not.toMatch(/NaN|undefined|Invalid Date/)
  const amounts = [...container.querySelectorAll('*')].filter((el) => !el.children.length && el.textContent.includes('GH₵'))
  if (!money?.refunded) expect(text).not.toContain('GH₵')
  else expect(amounts.length).toBeGreaterThan(0)
  for (const el of amounts) {
    expect(text).toContain(`GH₵ ${money.refunded}`)
    let tabular = false
    for (let n = el; n && n !== container.parentElement; n = n.parentElement) {
      if (n.style.fontVariantNumeric === 'tabular-nums') tabular = true
      expect(GOLD).not.toContain((n.style.color || '').toLowerCase())
    }
    expect(tabular).toBe(true)
  }
}

const wrap = (ui) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
)

describe('Booking money conformance sweep', () => {
  for (const kind of ['stay', 'tickets']) {
    for (const [name, money] of Object.entries(STATES)) {
      it(`BookingMoneyBar ${kind}: ${name}`, async () => {
        const { container } = render(wrap(
          <BookingMoneyBar kind={kind} money={money} cancelPath="/api/x/cancel/" reportPath="/api/y/report-problem/"
            about={{ name: 'Ashanti Lodge' }} ticketCount={3} onChanged={() => {}} onContactSupport={() => {}} />,
        ))
        if (money) await waitFor(() => expect(container.textContent).not.toBe(''))
        sweep(container, money)
      })
    }
  }

  for (const status of ['in_progress', 'completed']) {
    for (const [name, money] of Object.entries(STATES)) {
      it(`ServiceAcceptBar ${status}: ${name}`, () => {
        const request = { id: 7, status, listing_name: 'Plumbing', auto_accept_at: '2099-10-12T14:00:00Z', settled: false, problem_reported: false, money }
        const { container } = render(wrap(<ServiceAcceptBar request={request} onChanged={() => {}} onContactSupport={() => {}} />))
        sweep(container, money)
      })
    }
  }
})
