import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import BusinessCommandCenter from '../BusinessCommandCenter.jsx'

// The go-live rule's email blocker shows at the top of the owner's dashboard until the server stops listing it.
const API = 'http://localhost:8000'

function renderDashboard(goLive) {
  server.use(
    http.get(`${API}/api/accounts/business-owners/me/profile/`, () => HttpResponse.json({ business_kind: 'product', has_hours: true })),
    http.get(`${API}/api/orders/owner/`, () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
    http.get(`${API}/api/listings/mine/`, () => HttpResponse.json([])),
    http.get(`${API}/api/hero/mine/`, () => HttpResponse.json([])),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <BusinessCommandCenter initialTab="analytics" onExit={vi.fn()} PaymentComponent={() => null}
        user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified', goLive }} auth={{ isLoading: false, logout: vi.fn() }} />
    </QueryClientProvider>,
  )
}

describe('BusinessCommandCenter email banner', () => {
  it('shows the banner while the email is unconfirmed', async () => {
    renderDashboard({ live: false, blockers: [{ code: 'email_unconfirmed', message: 'Open the link we emailed you.' }] })
    expect(await screen.findByText('Confirm your email to publish listings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument()
  })

  it('shows nothing once the business is live', async () => {
    renderDashboard({ live: true, blockers: [] })
    await screen.findByRole('heading', { name: 'Add your shop location' })
    expect(screen.queryByText('Confirm your email to publish listings')).not.toBeInTheDocument()
  })
})
