import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import BusinessCommandCenter from '../BusinessCommandCenter.jsx'

// The plan purchase and renewal UI follows GET /api/billing/plans/: it goes
// away only once that has answered [] (see lib/plansOffered.js).

const API = 'http://localhost:8000'
const PLAN = { id: 1, tier: 'growth', name: 'Growth', monthly_price: '30.00', kind: 'product', features: [], is_recommended: false }
const OVERDUE = {
  id: 5, plan: { name: 'Growth', tier: 'growth' }, cycle_months: 1, is_trial: false, status: 'active',
  current_period_start: '2026-09-07T00:00:00Z', current_period_end: '2026-10-07T00:00:00Z',
  clock: {
    state: 'overdue', is_trial: false, plan_name: 'Growth', monthly_price: '120.00', current_period_end: '2026-10-07T00:00:00Z',
    overdue_since: '2026-10-07T00:00:00Z', overdue_day: 4, pause_at: '2026-10-21T00:00:00Z', hide_on: '2026-10-21',
    renew_by: '2026-10-20', paused_at: null,
  },
}

function renderDashboard({ plans, subscription }) {
  const seen = { plans: false, subscription: false }
  server.use(
    http.get(`${API}/api/accounts/business-owners/me/profile/`, () => HttpResponse.json({ business_kind: 'product', has_hours: true })),
    http.get(`${API}/api/orders/owner/`, () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
    http.get(`${API}/api/listings/mine/`, () => HttpResponse.json([])),
    http.get(`${API}/api/billing/plans/`, () => { seen.plans = true; return HttpResponse.json(plans) }),
    http.get(`${API}/api/billing/subscriptions/me/`, () => { seen.subscription = true; return HttpResponse.json(subscription) }),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <BusinessCommandCenter initialTab="deliveries" onExit={vi.fn()} PaymentComponent={() => null}
        user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }} auth={{ isLoading: false, logout: vi.fn() }} />
    </QueryClientProvider>,
  )
  return seen
}

const subscriptionTab = () => screen.queryAllByRole('button', { name: /Subscription/ })

describe('BusinessCommandCenter when no plans are offered', () => {
  it('no subscription tab when no plans are offered and none is held', async () => {
    const seen = renderDashboard({ plans: [], subscription: {} })
    await screen.findAllByRole('button', { name: /Products/ })
    await waitFor(() => expect(seen.plans && seen.subscription).toBe(true))
    await waitFor(() => expect(subscriptionTab()).toHaveLength(0))
  })

  it('the tab stays for a business that holds a plan', async () => {
    const seen = renderDashboard({ plans: [], subscription: { ...OVERDUE, clock: { ...OVERDUE.clock, state: 'active' } } })
    await waitFor(() => expect(seen.plans && seen.subscription).toBe(true))
    await screen.findAllByRole('button', { name: /Products/ })
    // Let the answered empty plan list settle before asserting the tab is still there.
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(subscriptionTab().length).toBeGreaterThan(0)
  })

  it('the tab shows while plans exist, even with no plan held', async () => {
    renderDashboard({ plans: [PLAN], subscription: {} })
    await waitFor(() => expect(subscriptionTab().length).toBeGreaterThan(0))
  })

  it('no renew banner when no plans are offered', async () => {
    const seen = renderDashboard({ plans: [], subscription: OVERDUE })
    await waitFor(() => expect(seen.plans && seen.subscription).toBe(true))
    await screen.findAllByRole('button', { name: /Products/ })
    await waitFor(() => expect(screen.queryByText(/Your subscription has ended/)).not.toBeInTheDocument())
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(screen.queryByRole('button', { name: 'Renew now' })).not.toBeInTheDocument()
  })

  it('the renew banner shows while plans exist', async () => {
    renderDashboard({ plans: [PLAN], subscription: OVERDUE })
    expect(await screen.findByText(/Your subscription has ended/)).toBeInTheDocument()
  })
})
