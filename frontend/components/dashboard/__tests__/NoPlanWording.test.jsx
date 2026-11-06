import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import AnalyticsPanel from '../panels/AnalyticsPanel.jsx'

// With no plan on offer (GET /api/billing/plans/ answers []) the Overview shows
// no plan or renewal wording, even for an owner whose old subscription row is
// still on file. The backend sends that row with an empty NONE clock.

const API = 'http://localhost:8000'
const PLAN = { id: 1, tier: 'growth', name: 'Growth', monthly_price: '30.00', kind: 'product', features: [], is_recommended: false }
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString()
const LEGACY_ROW = {
  id: 5, plan: { name: 'Growth', tier: 'growth', max_active_listings: 20 }, cycle_months: 1, is_trial: false, status: 'active',
  current_period_start: inDays(-25), current_period_end: inDays(5),
  clock: { state: 'none', current_period_end: null, pause_enabled: false },
}

function renderPanel({ plans, subscription }) {
  const seen = { plans: false, subscription: false }
  server.use(
    http.get(`${API}/api/accounts/business-owners/me/profile/`, () => HttpResponse.json({ business_kind: 'product' })),
    http.get(`${API}/api/hero/mine/`, () => HttpResponse.json({})),
    http.get(`${API}/api/listings/mine/`, () => HttpResponse.json([])),
    http.get(`${API}/api/billing/plans/`, () => { seen.plans = true; return HttpResponse.json(plans) }),
    http.get(`${API}/api/billing/subscriptions/me/`, () => { seen.subscription = true; return HttpResponse.json(subscription) }),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AnalyticsPanel user={{ id: 3, fullName: 'Abena Mensah' }} onNavigate={vi.fn()} businessKind="product" />
    </QueryClientProvider>,
  )
  return seen
}

describe('AnalyticsPanel plan wording', () => {
  it('shows no plan, renewal or subscription wording when no plan is offered', async () => {
    const seen = renderPanel({ plans: [], subscription: LEGACY_ROW })
    await screen.findByText(/Akwaaba, Abena/)
    await waitFor(() => expect(seen.plans && seen.subscription).toBe(true))
    await waitFor(() => expect(screen.queryByText('Subscription')).not.toBeInTheDocument())
    const text = document.body.textContent
    expect(text).not.toMatch(/renew|No active (plan|subscription)|Growth plan|Plan usage|Subscribe to a plan|Transactions & plan/i)
    expect(screen.queryByText('Subscription')).not.toBeInTheDocument()
    // The other tiles are untouched.
    expect(screen.getByText('Active Listings')).toBeInTheDocument()
    expect(screen.getByText('Credit Score')).toBeInTheDocument()
    expect(screen.getByText('View Payments')).toBeInTheDocument()
    expect(screen.getByText('Transactions')).toBeInTheDocument()
  })

  it('shows no unsubscribed wording for an owner with no row either', async () => {
    const seen = renderPanel({ plans: [], subscription: {} })
    await screen.findByText(/Akwaaba, Abena/)
    await waitFor(() => expect(seen.plans && seen.subscription).toBe(true))
    await waitFor(() => expect(screen.queryByText('Subscription')).not.toBeInTheDocument())
    expect(document.body.textContent).not.toMatch(/No active (plan|subscription)|Subscribe to a plan|Plan usage/i)
  })

  it('keeps today\'s wording while plans are offered', async () => {
    renderPanel({ plans: [PLAN], subscription: LEGACY_ROW })
    expect(await screen.findByText('Renews in 5d')).toBeInTheDocument()
    expect(screen.getByText('Subscription')).toBeInTheDocument()
    expect(screen.getByText(/Growth plan • active • renews in 5 days/)).toBeInTheDocument()
    expect(screen.getByText(/Plan usage/)).toBeInTheDocument()
    expect(screen.getByText('Transactions & plan')).toBeInTheDocument()
  })

  it('keeps today\'s wording for an owner with no subscription while plans are offered', async () => {
    renderPanel({ plans: [PLAN], subscription: {} })
    expect(await screen.findByText('No active plan')).toBeInTheDocument()
    expect(screen.getByText('💳 No active subscription yet — see the Subscription tab')).toBeInTheDocument()
  })
})
