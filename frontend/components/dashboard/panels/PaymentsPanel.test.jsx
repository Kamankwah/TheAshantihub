import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import PaymentsPanel from './PaymentsPanel.jsx'
import { server } from '../../../mocks/server.js'

// The Reminders tab's subscription reminder. With the subscription pause
// switched off (clock.pause_enabled false, user decision U3) an unpaid
// subscription hides nothing, so the reminder doesn't promise to keep the
// listings live.

const API = 'http://localhost:8000'
const lapsed = (clock) => ({
  id: 5, plan: { name: 'Growth', tier: 'growth' }, cycle_months: 1, is_trial: false, status: 'active',
  current_period_start: '2026-08-07T00:00:00Z', current_period_end: new Date(Date.now() - 3 * 86400000).toISOString(),
  clock: { state: 'overdue', overdue_day: 4, ...clock },
})

async function openReminders(subscription) {
  server.use(
    // Subscriptions are on here (the "none offered" wording has its own cases below).
    http.get(`${API}/api/billing/plans/`, () => HttpResponse.json([{ id: 1, tier: 'growth', name: 'Growth', kind: 'product', monthly_price: '30.00', features: [] }])),
    http.get(`${API}/api/billing/subscriptions/me/`, () => HttpResponse.json(subscription)),
    http.get(`${API}/api/events/mine/`, () => HttpResponse.json([])),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PaymentsPanel user={{ fullName: 'Abena' }} PaymentComponent={() => null} businessKind="product" />
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: /Reminders/ }))
  return screen.findByText('Your subscription has lapsed')
}

describe('PaymentsPanel subscription reminder', () => {
  it('asks the owner to keep their plan when the pause is switched off', async () => {
    await openReminders(lapsed({ pause_enabled: false }))
    expect(screen.getByText('Renew from the plans below to keep your plan.')).toBeInTheDocument()
    expect(screen.queryByText(/listings live/)).not.toBeInTheDocument()
  })

  it('keeps the listings-live wording while the pause is on', async () => {
    await openReminders(lapsed({ pause_enabled: true }))
    expect(screen.getByText('Renew from the plans below to keep your listings live.')).toBeInTheDocument()
  })
})

describe('PaymentsPanel sales overview customer column', () => {
  const report = (extra) => ({
    summary: { total_sales: '100.00', order_count: 1, item_count: 1 },
    series: [],
    rows: [{ order_id: 1, date: '2026-10-01T10:00:00Z', customer: 'Yaa Buyer', item: 'Kente Cloth', kind: 'product', quantity: 1, line_total: '100.00' }],
    ...extra,
  })
  async function openOverview(body) {
    server.use(
      http.get(`${API}/api/orders/owner/report/`, () => HttpResponse.json(body)),
      http.get(`${API}/api/events/mine/`, () => HttpResponse.json([])),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsPanel user={{ fullName: 'Abena' }} PaymentComponent={() => null} businessKind="product" />
      </QueryClientProvider>,
    )
    await screen.findByText(/Kente Cloth/)
  }

  it('hides the customer column when the report says customer_names false', async () => {
    await openOverview(report({ customer_names: false, rows: report().rows.map(({ customer, ...r }) => r) }))
    expect(screen.queryByText('Customer')).not.toBeInTheDocument()
    expect(screen.queryByText('Yaa Buyer')).not.toBeInTheDocument()
    expect(screen.getByText('Qty')).toBeInTheDocument()
  })

  it('keeps the customer column when the flag is absent or true', async () => {
    await openOverview(report({ customer_names: true }))
    expect(screen.getByText('Customer')).toBeInTheDocument()
    expect(screen.getByText('Yaa Buyer')).toBeInTheDocument()
  })

  it('keeps the customer column when the flag is absent', async () => {
    await openOverview(report())
    expect(screen.getByText('Customer')).toBeInTheDocument()
  })
})

describe('PaymentsPanel when no plans are offered', () => {
  function renderPanel(subscription, plans) {
    server.use(
      http.get(`${API}/api/billing/plans/`, () => HttpResponse.json(plans)),
      http.get(`${API}/api/billing/subscriptions/me/`, () => HttpResponse.json(subscription)),
      http.get(`${API}/api/events/mine/`, () => HttpResponse.json([])),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsPanel user={{ fullName: 'Abena' }} PaymentComponent={() => null} businessKind="product" />
      </QueryClientProvider>,
    )
  }

  it('no plan grid and no renew prompt when none are offered', async () => {
    renderPanel({}, [])
    fireEvent.click(screen.getByRole('button', { name: /My Transactions & Subscription/ }))
    expect(await screen.findByText('Subscriptions are not being offered right now.')).toBeInTheDocument()
    expect(screen.queryByText(/choose a plan below/i)).not.toBeInTheDocument()
    expect(screen.queryByText('⭐ Plans')).not.toBeInTheDocument()
    expect(screen.queryByText('💰 Pay with MoMo')).not.toBeInTheDocument()

    cleanup()
    renderPanel(lapsed({ pause_enabled: true }), [])
    fireEvent.click(screen.getByRole('button', { name: /Reminders/ }))
    expect(await screen.findByText('Subscriptions are not being offered right now, so it cannot be renewed.')).toBeInTheDocument()
    expect(screen.queryByText(/Renew from the plans below/)).not.toBeInTheDocument()
  })

  it('keeps the plan grid while the plans exist', async () => {
    renderPanel({}, [{ id: 1, tier: 'growth', name: 'Growth', monthly_price: '30.00', kind: 'product', features: [], is_recommended: false }])
    fireEvent.click(screen.getByRole('button', { name: /My Transactions & Subscription/ }))
    expect(await screen.findByText('Growth')).toBeInTheDocument()
    expect(screen.getByText('⭐ Plans')).toBeInTheDocument()
  })
})
