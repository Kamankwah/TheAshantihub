import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import BusinessCommandCenter from '../BusinessCommandCenter.jsx'
import RenewBanner from '../RenewBanner.jsx'

// billing.clock.subscription_state() — overdue since 7 Oct, paused at the
// start of day 15 (21 Oct), so renew by 20 Oct.
const clock = (overrides = {}) => ({
  state: 'overdue', is_trial: false, plan_name: 'Growth', monthly_price: '120.00',
  current_period_end: '2026-10-07T00:00:00Z', overdue_since: '2026-10-07T00:00:00Z', overdue_day: 4,
  pause_at: '2026-10-21T00:00:00Z', hide_on: '2026-10-21', renew_by: '2026-10-20', paused_at: null, ...overrides,
})
const subscription = (clockOverrides = {}) => ({
  id: 5, plan: { name: 'Growth', tier: 'growth' }, cycle_months: 1, is_trial: false, status: 'active',
  current_period_start: '2026-09-07T00:00:00Z', current_period_end: '2026-10-07T00:00:00Z', clock: clock(clockOverrides),
})

describe('RenewBanner', () => {
  it('renders nothing without a running clock', () => {
    for (const sub of [undefined, {}, subscription({ state: 'active' }), subscription({ state: 'trial' }), { clock: clock({ state: 'none' }) }]) {
      const { container, unmount } = render(<RenewBanner subscription={sub} onRenew={vi.fn()} />)
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
  })

  it('tells an overdue owner the day and the date to renew by', () => {
    const onRenew = vi.fn()
    render(<RenewBanner subscription={subscription()} onRenew={onRenew} />)
    expect(screen.getByText('Your subscription has ended. Renew by 20 Oct to keep your listings visible.')).toBeInTheDocument()
    expect(screen.getByText('Day 4 of 14')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Renew now' }))
    expect(onRenew).toHaveBeenCalledTimes(1)
  })

  it('tells a paused owner their listings are hidden, not deleted', () => {
    render(<RenewBanner subscription={subscription({ state: 'paused', overdue_day: null, paused_at: '2026-10-21T00:05:00Z' })} onRenew={vi.fn()} />)
    expect(screen.getByText('Your listings are hidden until you renew. Nothing has been deleted.')).toBeInTheDocument()
    expect(screen.queryByText(/Day \d+ of 14/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Renew now' })).toBeInTheDocument()
  })
})

describe('RenewBanner in the business dashboard', () => {
  function mockDashboard(sub) {
    const seen = { subscription: false }
    server.use(
      http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json({ business_kind: null })),
      http.get('http://localhost:8000/api/orders/owner/', () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
      http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/billing/subscriptions/me/', () => { seen.subscription = true; return HttpResponse.json(sub) }),
    )
    return seen
  }
  function renderDashboard(kycStatus) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <BusinessCommandCenter initialTab="deliveries" onExit={vi.fn()} PaymentComponent={() => null}
          user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus }} auth={{ isLoading: false, logout: vi.fn() }} />
      </QueryClientProvider>,
    )
  }

  it('sits at the top of a verified dashboard, and Renew now opens the Subscription tab', async () => {
    mockDashboard(subscription())
    renderDashboard('verified')
    expect(await screen.findByText('Your subscription has ended. Renew by 20 Oct to keep your listings visible.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Renew now' }))
    expect(await screen.findByRole('heading', { name: '💳 Subscription' })).toBeInTheDocument()
  })

  it('is not shown while KYC is pending', async () => {
    const seen = mockDashboard(subscription())
    renderDashboard('pending')
    await waitFor(() => expect(seen.subscription).toBe(true))
    expect(screen.getByText(/under review/i)).toBeInTheDocument()
    expect(screen.queryByText(/Your subscription has ended/)).not.toBeInTheDocument()
  })
})
