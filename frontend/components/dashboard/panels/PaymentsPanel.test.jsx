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
