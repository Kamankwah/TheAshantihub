import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { MoMoPayment } from '../../../App.jsx'
import SubscriptionPanel from './SubscriptionPanel.jsx'
import { server } from '../../../mocks/server.js'

function renderWithQueryClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const PLAN = {
  id: 1, tier: 'growth', name: 'Growth', monthly_price: '30.00', kind: 'product',
  max_active_listings: 10, features: ['Featured placement'], is_recommended: true,
}

function mockPlans(plans = [PLAN]) {
  server.use(
    http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json(plans)),
  )
}

function mockSubscription(sub = {}) {
  server.use(
    http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json(sub)),
  )
}

function renderPanel({ plans = [PLAN], subscription = {}, showToast = vi.fn(), businessKind } = {}) {
  mockPlans(plans)
  mockSubscription(subscription)
  return renderWithQueryClient(
    <SubscriptionPanel user={{ fullName: 'Abena' }} PaymentComponent={MoMoPayment} showToast={showToast} businessKind={businessKind} />,
  )
}

const SERVICE_PLAN = {
  id: 2, tier: 'service_pro', name: 'Service Pro', monthly_price: '40.00', kind: 'service',
  max_active_listings: 5, features: ['Priority support'], is_recommended: false,
}

describe('SubscriptionPanel cycle-length selector', () => {
  it('defaults to 1 month and shows the flat monthly_price', async () => {
    renderPanel()
    await screen.findByText('Growth')
    expect(screen.getByText('GHS 30')).toBeInTheDocument()
  })

  it('selecting "3 months" on a GHS30/mo plan shows GHS90', async () => {
    renderPanel()
    await screen.findByText('Growth')
    fireEvent.click(screen.getByText('3 months'))
    expect(screen.getByText('GHS 90')).toBeInTheDocument()
  })

  it('shows the plan kind label and max_active_listings when present', async () => {
    renderPanel()
    await screen.findByText('Growth')
    expect(screen.getByText('Product')).toBeInTheDocument()
    expect(screen.getByText(/Up to 10 active listings/)).toBeInTheDocument()
  })
})

describe('SubscriptionPanel business-kind plan filtering', () => {
  it('shows only product-kind plans for a product business', async () => {
    renderPanel({ plans: [PLAN, SERVICE_PLAN], businessKind: 'product' })
    await screen.findByText('Growth')
    expect(screen.queryByText('Service Pro')).not.toBeInTheDocument()
  })

  it('shows only service-kind plans for a service business', async () => {
    renderPanel({ plans: [PLAN, SERVICE_PLAN], businessKind: 'service' })
    await screen.findByText('Service Pro')
    expect(screen.queryByText('Growth')).not.toBeInTheDocument()
  })

  it('shows all plans when business_kind is null (older accounts)', async () => {
    renderPanel({ plans: [PLAN, SERVICE_PLAN], businessKind: null })
    await screen.findByText('Growth')
    expect(screen.getByText('Service Pro')).toBeInTheDocument()
  })
})

describe('SubscriptionPanel renew-now banner', () => {
  it('appears when current_period_end is in the past', async () => {
    renderPanel({
      subscription: {
        id: 5, plan: PLAN, cycle_months: 3, is_trial: false, status: 'active',
        current_period_start: '2026-01-01T00:00:00Z', current_period_end: '2026-04-01T00:00:00Z',
      },
    })
    await screen.findByText(/Growth Plan/)
    expect(await screen.findByText('⏰ Your subscription has expired')).toBeInTheDocument()
    expect(screen.getByText('Renew Now')).toBeInTheDocument()
  })

  it('is absent when current_period_end is in the future', async () => {
    renderPanel({
      subscription: {
        id: 5, plan: PLAN, cycle_months: 3, is_trial: false, status: 'active',
        current_period_start: '2026-01-01T00:00:00Z', current_period_end: '2099-04-01T00:00:00Z',
      },
    })
    await screen.findByText(/Growth Plan/)
    expect(screen.queryByText('⏰ Your subscription has expired')).not.toBeInTheDocument()
  })

  it('is absent when there is no subscription yet', async () => {
    renderPanel({ subscription: {} })
    await screen.findByText('🎁 No Active Subscription')
    expect(screen.queryByText('⏰ Your subscription has expired')).not.toBeInTheDocument()
  })

  it('clicking Renew Now pre-selects the subscription\'s own plan/cycle and opens the pay flow', async () => {
    renderPanel({
      subscription: {
        id: 5, plan: PLAN, cycle_months: 3, is_trial: false, status: 'active',
        current_period_start: '2026-01-01T00:00:00Z', current_period_end: '2026-04-01T00:00:00Z',
      },
    })
    fireEvent.click(await screen.findByText('Renew Now'))
    expect(screen.getByText('💰 Mobile Money Payment')).toBeInTheDocument()
    // amount reflects the subscription's own cycle_months (3) * monthly_price (30) = 90
    expect(screen.getByText('GHS 90.00')).toBeInTheDocument()
  })
})

describe('SubscriptionPanel pay flow posts the new {plan, cycle_months} shape', () => {
  it('selecting a cycle+plan and completing the simulated pay flow POSTs the new shape', async () => {
    renderPanel()
    await screen.findByText('Growth')
    fireEvent.click(screen.getByText('3 months'))

    let subscribeBody = null
    server.use(
      http.post('http://localhost:8000/api/billing/transactions/mine/', () => HttpResponse.json({ id: 1 })),
      http.post('http://localhost:8000/api/billing/subscriptions/me/', async ({ request }) => {
        subscribeBody = await request.json()
        return HttpResponse.json({ id: 5, plan: PLAN, cycle_months: 3, is_trial: false, status: 'active' })
      }),
    )

    fireEvent.click(screen.getByText('💰 Pay with MoMo'))
    expect(screen.getByText('💰 Mobile Money Payment')).toBeInTheDocument()
    fireEvent.click(screen.getByText('MTN MoMo'))
    fireEvent.change(screen.getByPlaceholderText('0244 000 000'), { target: { value: '0244000000' } })

    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.click(screen.getByText(/Pay GHS/))
    await vi.advanceTimersByTimeAsync(4100)
    vi.useRealTimers()

    await waitFor(() => expect(subscribeBody).toEqual({ plan: 'growth', cycle_months: 3 }))
  })
})
