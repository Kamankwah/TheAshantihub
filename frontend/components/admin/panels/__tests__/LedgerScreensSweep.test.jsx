import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import PickupDeskPanel from '../PickupDeskPanel.jsx'
import VerificationCallsPanel from '../VerificationCallsPanel.jsx'

// Cross-screen sweep for Plan 1F: no WhatsApp, no business phone, no collection code, no NaN/undefined, money in
// tabular figures and never gold.
const API = 'http://localhost:8000/api'
const CODE = '482913'
const BUSINESS_PHONE = '0200000000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const envelope = (results) => HttpResponse.json({ count: results.length, next: null, previous: null, results })
const desk = { user: { role: 'pickup_desk' }, hasPermission: (c) => c === 'pickup.confirm' }
const support = { user: { role: 'support' }, hasPermission: (c) => c === 'orders.verify' || c === 'orders.support_update' }
const pickupRow = { order_id: 41, placed_at: '2026-10-20T10:00:00Z', collect_by: '2026-10-23T10:00:00Z', overdue: false, customer_name: 'Ama Mensah', items: [{ name: 'Solar lamp', quantity: 2, business: 'Bright Stores' }] }
const orderRow = {
  order_id: 41, placed_at: '2026-10-20T10:00:00Z', due_by: '2026-10-22T10:00:00Z', overdue: false, delivery_method: 'store_pickup',
  customer_name: 'Ama Mensah', customer_phone: '+233241112233', items: [{ name: 'Solar lamp', quantity: 2, business: 'Bright Stores' }],
  customer_confirmed: false, outcome: '', outcome_note: '', released: false,
}
const bookingRow = {
  sale_id: 7, kind: 'service', what: 'Home Cleaning', paid_at: '2026-10-20T10:00:00Z', business: 'Bright Cleaners', customer_name: 'Ama Mensah',
  customer_phone: '024 *** 2233', amount: '200.00', handed_over_at: null, cancellable: true, release_at: null, due_by: '2026-10-25T10:00:00Z',
  customer_confirmed: false, outcome: '', outcome_note: '', released: false,
}

function sweep(container, { allowTel = false } = {}) {
  const text = container.textContent
  expect(container.querySelector('a[href*="wa.me"]')).toBeNull()
  expect(text).not.toMatch(/wa\.me/i)
  if (!allowTel) expect(container.querySelector('a[href^="tel:"]')).toBeNull()
  expect(text).not.toContain(BUSINESS_PHONE)
  expect(text).not.toContain(CODE)
  expect(text).not.toMatch(/\bNaN\b|\bundefined\b/)
  // Every GH₵ amount is inside a [data-amount] element (deepest element whose text carries one).
  const moneyRe = /GH₵\s?\d/
  container.querySelectorAll('*').forEach((el) => {
    if (!moneyRe.test(el.textContent)) return
    if ([...el.children].some((c) => moneyRe.test(c.textContent))) return
    expect(el.closest('[data-amount]'), `unmarked amount: ${el.textContent}`).not.toBeNull()
  })
  container.querySelectorAll('[data-amount]').forEach((el) => {
    expect(el.style.fontVariantNumeric).toBe('tabular-nums')
    expect(el.outerHTML.toLowerCase()).not.toContain('#d4a017')
    expect(el.style.color.toLowerCase()).not.toMatch(/212,\s*160,\s*23|#d4a017/)
  })
}

describe('1F screens sweep', () => {
  it('pickup desk with an address and without', async () => {
    server.use(
      http.get(`${API}/ledger/pickup/`, () => envelope([{ ...pickupRow, collection_code: CODE, business_phone: BUSINESS_PHONE }])),
      http.get(`${API}/core/site-settings/`, () => HttpResponse.json({ pickup_office_address: 'Adum, next to the Post Office' })),
    )
    const a = wrap(<PickupDeskPanel auth={desk} />)
    await screen.findByText('Order #41')
    await screen.findByText('Pickup office address: Adum, next to the Post Office')
    sweep(a.container)
    a.unmount()
    server.use(http.get(`${API}/core/site-settings/`, () => HttpResponse.json({ pickup_office_address: '' })))
    const b = wrap(<PickupDeskPanel auth={desk} />)
    await screen.findByText('Pickup office address: to be confirmed')
    sweep(b.container)
  })

  it('the three verification tabs', async () => {
    server.use(
      http.get(`${API}/ledger/orders/awaiting-verification/`, () => envelope([{ ...orderRow, business_phone: BUSINESS_PHONE }])),
      http.get(`${API}/ledger/bookings/awaiting-verification/`, () => envelope([{ ...bookingRow, business_phone: BUSINESS_PHONE }])),
      http.get(`${API}/ledger/bookings/`, () => HttpResponse.json({ results: [{ ...bookingRow, business_phone: BUSINESS_PHONE }] })),
    )
    const { container } = wrap(<VerificationCallsPanel auth={support} />)
    await screen.findByText('Order #41')
    // Support's lists carry the customer's own phone as a call link; nothing else may.
    expect(container.querySelectorAll('a[href^="tel:"]')).toHaveLength(1)
    sweep(container, { allowTel: true })

    fireEvent.click(screen.getByRole('button', { name: 'Bookings' }))
    await screen.findByText('Home Cleaning')
    expect(container.querySelectorAll('[data-amount]').length).toBeGreaterThan(0)
    sweep(container, { allowTel: true })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel a booking' }))
    await screen.findByRole('button', { name: 'Cancel booking…' })
    expect(container.querySelectorAll('[data-amount]').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking…' }))
    await screen.findByText(/The payment processing charge is not refunded/)
    sweep(container) // the cancel tab shows the masked phone only: no tel: link
  })
})
