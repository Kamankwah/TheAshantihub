import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import BusinessCommandCenter from '../BusinessCommandCenter.jsx'

// Where the shop-location card sits in the owner's dashboard: on the Overview of an approved business, and (so the
// pin can be shared in time to be approved) while the application is under review; never on another tab or after a
// rejection.
const API = 'http://localhost:8000'

function renderDashboard({ kycStatus = 'verified', initialTab = 'analytics' } = {}) {
  server.use(
    http.get(`${API}/api/accounts/business-owners/me/profile/`, () => HttpResponse.json({ business_kind: 'product', has_hours: true })),
    http.get(`${API}/api/orders/owner/`, () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
    http.get(`${API}/api/listings/mine/`, () => HttpResponse.json([])),
    http.get(`${API}/api/hero/mine/`, () => HttpResponse.json([])),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <BusinessCommandCenter initialTab={initialTab} onExit={vi.fn()} PaymentComponent={() => null}
        user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus }} auth={{ isLoading: false, logout: vi.fn() }} />
    </QueryClientProvider>,
  )
}

describe('BusinessCommandCenter shop location card', () => {
  it('prompts for the shop location on the Overview of an approved business', async () => {
    renderDashboard()
    expect(await screen.findByRole('heading', { name: 'Add your shop location' })).toBeInTheDocument()
  })

  it('prompts while the application is under review', async () => {
    renderDashboard({ kycStatus: 'pending' })
    expect(await screen.findByRole('heading', { name: 'Add your shop location' })).toBeInTheDocument()
  })

  it('does not appear on another tab, or after a rejection', async () => {
    const seen = []
    server.events.on('request:start', ({ request }) => { if (request.url.endsWith('/me/location/')) seen.push(request.url) })
    renderDashboard({ initialTab: 'deliveries' })
    await screen.findAllByRole('button', { name: /Products/ })
    expect(screen.queryByRole('heading', { name: 'Add your shop location' })).not.toBeInTheDocument()
    expect(seen).toEqual([])
  })

  it('is not shown to a rejected application', async () => {
    renderDashboard({ kycStatus: 'rejected' })
    await screen.findByText('Your application needs changes')
    expect(screen.queryByRole('heading', { name: 'Add your shop location' })).not.toBeInTheDocument()
  })
})
