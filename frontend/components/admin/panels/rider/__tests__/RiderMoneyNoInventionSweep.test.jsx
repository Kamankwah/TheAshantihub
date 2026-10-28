import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../../mocks/server.js'
import RiderWalletHome from '../RiderWalletHome.jsx'
import { RiderDays, RiderDeliveries, RiderStatement } from '../RiderWalletHistory.jsx'
import RiderEarningsTab from '../RiderEarningsTab.jsx'
import RiderMoneyPanel from '../../RiderMoneyPanel.jsx'
import RiderWalletDetail from '../../RiderWalletDetail.jsx'
import RiderEmploymentSection from '../../delivery/RiderEmploymentSection.jsx'
import RedeliveriesPanel from '../../RedeliveriesPanel.jsx'
import DisputesCases from '../../delivery/DisputesCasesPanel.jsx'

// Wallet 5F closeout: one populated fixture per money screen (a negative balance, a 10.5% rate stored as 1050 basis
// points, a "99999999.99" amount) and the rules from DESIGN.md and the brief: no contact route to a person, no invented
// value, money in tabular figures and never gold.
const API = 'http://localhost:8000'
const RW = `${API}/api/delivery/rider/wallet`
const BIG = '99999999.99'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const envelope = (results) => HttpResponse.json({ count: results.length, next: null, previous: null, results })

const summary = {
  kind: 'rider', balance: '-13.50', balance_note: 'You are GH₵ 13.50 below zero after a refund.', reserve: BIG, reserve_note: 'Held against refunds for now.',
  commission_bp: 1050, company_name: 'Kofi Riders Ltd', awaiting_release: 2, withdrawals_per_day: 3, withdrawals_today: 1,
  withdrawals_reset_at: '2026-10-21T00:00:00Z',
}
const earning = { id: 1, order: 501, kind: 'delivery', delivered_at: '2026-10-20T10:30:00Z', earned_at: '2026-10-20T10:31:00Z', earned_on: '2026-10-20', gross: BIG, commission_bp: 1050, commission: '1.26', you_got: '10.74', status: 'paid', status_label: 'Paid to your wallet', reversed_at: null }
const dayRow = { day: '2026-10-19', deliveries: 4, gross: BIG, commission: '5.04', net: '42.96', given_back: '3.00' }
const line = { id: 1, at: '2026-10-20T10:30:00Z', account: 'balance', kind: 'rider_earning', label: 'Delivery earning', direction: 'in', amount: BIG, order: 501, reference: '' }
const dest = { id: 7, rail: 'momo', institution: 'MTN', account_name: 'Kojo Rider', account_number_masked: '024****567', usable_from: '2026-10-01T10:00:00Z', usable: true, removed: false }
const wd = { id: 1, reference: 'WD-1', amount: BIG, charge: '1.00', you_receive: '49.00', status: 'processing', status_label: 'Processing', destination: dest, created_at: '2026-10-20T10:05:00Z', settled_at: null, failure_reason: '' }

function riderWalletApi() {
  server.use(
    http.get(`${RW}/`, () => HttpResponse.json(summary)),
    http.get(`${RW}/earnings/`, () => envelope([earning])),
    http.get(`${RW}/days/`, () => HttpResponse.json({ results: [dayRow] })),
    http.get(`${RW}/statement/`, () => envelope([line])),
    http.get(`${RW}/destinations/`, () => HttpResponse.json({ results: [dest], cooling_hours: 24 })),
    http.get(`${RW}/withdrawals/`, () => envelope([wd])),
    http.get(`${API}/api/delivery/rider/me/`, () => HttpResponse.json({ rider: { id: 1, full_name: 'Kofi', wallet: true } })),
    http.get(`${API}/api/delivery/rider/earnings/`, () => HttpResponse.json({ total: null, results: [], jobs: 0, jobs_without_pay: 0, could_not_deliver: 0, rates: null, payouts: { note: 'Payouts are prepared by Accounting.' } })),
  )
}

// An element that shows an amount: GH₵ followed by a figure. A bare "(GH₵)" unit in a field label (3F's
// WithdrawForm) carries no figure.
const SHOWS = /GH₵\s?[\d,]*\d/
const hasMoney = (el) => SHOWS.test(el.textContent || '') && ![...el.children].some((c) => SHOWS.test(c.textContent || ''))
const tabular = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.style && /tabular-nums/.test(n.style.fontVariantNumeric || n.style.cssText)) return true
  }
  return false
}
function sweep(container = document.body) {
  expect(container.querySelectorAll('a[href^="tel:"]')).toHaveLength(0)
  expect(container.querySelectorAll('a[href*="wa.me"]')).toHaveLength(0)
  const text = container.textContent || ''
  expect(text).not.toMatch(/wa\.me/)
  expect(text).not.toMatch(/\d{10,}/)
  expect(text).not.toMatch(/\bNaN\b|undefined|\bnull\b/)
  expect(text).not.toContain('1.5%')
  const money = [...container.querySelectorAll('*')].filter(hasMoney)
  expect(money.length).toBeGreaterThan(0)
  for (const el of money) {
    expect(tabular(el), `not tabular: "${el.textContent.slice(0, 60)}"`).toBe(true)
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const colour = ((n.getAttribute('style') || '').match(/(?:^|;)\s*color:\s*([^;]+)/i) || [])[1] || ''
      expect(colour.toUpperCase(), `gold text on money: "${el.textContent.slice(0, 60)}"`).not.toMatch(/#D4A017|212,\s*160,\s*23/)
    }
  }
}

describe('Wallet 5F: no-invention sweep', () => {
  it('RiderWalletHome', async () => {
    riderWalletApi()
    wrap(<RiderWalletHome summary={summary} onNavigate={vi.fn()} onChanged={vi.fn()} />)
    await screen.findAllByText(/024\*+567/)
    sweep()
  })

  it('RiderDeliveries, RiderDays and RiderStatement', async () => {
    riderWalletApi()
    for (const [Comp, ready] of [[RiderDeliveries, 'Order #501'], [RiderDays, /2026/], [RiderStatement, 'Delivery earning']]) {
      const { unmount } = wrap(<Comp />)
      await screen.findAllByText(ready)
      sweep()
      unmount()
    }
  })

  it('RiderEarningsTab', async () => {
    riderWalletApi()
    wrap(<RiderEarningsTab onNavigate={vi.fn()} />)
    await screen.findByText('Your balance')
    sweep()
  })

  const staffAuth = { user: { token: 't', account_type: 'staff', id: 1, role: 'accountant' }, hasPermission: () => true }
  const staffRider = { holder_id: 7, rider_id: 3, name: 'Kwesi Rider', company_name: 'Swift Co', employment: 'third_party', balance: '-13.50', reserve: BIG }
  const staffDetail = {
    rider: { id: 3, staff_id: 9, name: 'Kwesi Rider', employment: 'third_party', company_name: 'Swift Co', third_party_since: '2026-09-01T08:00:00Z' },
    ...summary,
    earnings: [{ ...earning, status_label: 'Paid to wallet' }],
    days: [dayRow],
    withdrawals: [wd],
  }

  it('RiderMoneyPanel: Wallets, Daily commission and Withdrawals', async () => {
    server.use(
      http.get(`${API}/api/wallet/staff/wallets/`, () => envelope([staffRider])),
      http.get(`${API}/api/delivery/rider-commission/`, () => HttpResponse.json({
        day: '2026-10-19',
        results: [{ rider_id: 3, name: 'Kwesi Rider', company_name: 'Swift Co', deliveries: 3, gross: BIG, commission: '3.00', net: '27.00', given_back: '2.00', posted_at: '2026-10-19T00:05:00Z' }],
        totals: { deliveries: 3, gross: BIG, commission: '3.00', net: '27.00', given_back: '2.00' },
      })),
      http.get(`${API}/api/wallet/staff/withdrawals/`, () => envelope([{ id: 5, reference: 'WD-0005', amount: BIG, charge: '1.00', status: 'processing', status_label: 'Sent to provider', destination: { account_number_masked: '******4321' }, holder_type: 'staff', holder_id: 9, holder_name: 'Kwesi Rider', submitted_at: null, stuck: false }])),
    )
    wrap(<RiderMoneyPanel auth={staffAuth} />)
    await screen.findByText('Kwesi Rider')
    sweep()
    fireEvent.click(screen.getByRole('button', { name: 'Daily commission' }))
    await screen.findByRole('heading', { name: /Commission posted for/ })
    sweep()
    fireEvent.click(screen.getByRole('button', { name: 'Withdrawals' }))
    await screen.findByText('WD-0005')
    sweep()
  })

  it('RiderWalletDetail', async () => {
    server.use(http.get(`${API}/api/delivery/riders/3/wallet/`, () => HttpResponse.json(staffDetail)))
    wrap(<RiderWalletDetail riderId={3} onBack={vi.fn()} />)
    await screen.findByText('Order #501')
    sweep()
  })

  it('RiderEmploymentSection', () => {
    wrap(<RiderEmploymentSection riderId={9} employment={{ employment: 'third_party', employment_label: 'Third-party rider', company_name: 'Swift Riders', third_party_since: '2026-09-02T08:00:00Z', wallet: true, pending: null }} onDone={() => {}} />)
    expect(screen.getByText(/Works for: Third-party rider/)).toBeInTheDocument()
    const text = document.body.textContent
    expect(text).not.toMatch(/\bNaN\b|undefined|\bnull\b|wa\.me|\d{10,}/)
    expect(document.querySelectorAll('a[href^="tel:"]')).toHaveLength(0)
  })

  it('RedeliveriesPanel', async () => {
    server.use(http.get(`${API}/api/delivery/redeliveries/`, () => HttpResponse.json({
      results: [{ id: 5, order: 41, attempt: 1, status: 'awaiting_payment', status_label: 'Waiting for the customer to pay', fee: BIG, fee_pesewas: 9999999999, reason: 'Customer asked at the desk', requested_by: 'Esi Mensah', rider: null, paid_through: null }],
      redeliverable: false, redelivery_fee: null, not_redeliverable_reason: 'A re-delivery is already open for this order.',
    })))
    wrap(<RedeliveriesPanel />)
    fireEvent.change(screen.getByLabelText('Order number'), { target: { value: '41' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    await screen.findByText(/Waiting for the customer to pay/)
    sweep()
  })

  it('the delivery case DecisionForm', async () => {
    const data = {
      case: { id: 31, order_id: 7, case_type: 'not_received', case_type_label: 'Not received', status: 'open', status_label: 'Open', created_at: '2026-10-13T09:00:00Z', answer_due_at: null, minutes_left: null, overdue: false },
      description: 'Never arrived', reason: 'delivery_issue',
      order: { id: 7, total: BIG, address: 'Ahodwo', refundable: BIG, delivery_fee_kept: '15.00', free_delivery: { amount: '15.00', funded_by: 'platform' } },
      evidence: null, rider: null, decision: null, refund: null,
      outcomes: { refund: 'Refund the customer', no_refund: 'No refund' }, faults: { rider: 'Rider', none: 'No one' },
      payments: 'Payments are simulated until a payment provider is connected: a refund is recorded and approved, no money moves.',
    }
    server.use(http.get(`${API}/api/delivery/cases/31/`, () => HttpResponse.json(data)))
    wrap(<DisputesCases detailId="31" onOpenDetail={() => {}} />)
    await screen.findByText('Your decision')
    fireEvent.click(screen.getByLabelText('Refund the customer'))
    await waitFor(() => expect(screen.getByText(/Can still be refunded/)).toBeInTheDocument())
    sweep()
  })
})
