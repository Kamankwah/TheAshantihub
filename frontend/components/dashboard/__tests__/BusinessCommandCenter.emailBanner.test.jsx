import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import BusinessCommandCenter from '../BusinessCommandCenter.jsx'

// The go-live rule's email blocker shows at the top of the owner's dashboard until the server stops listing it.
const API = 'http://localhost:8000'

function renderDashboard(goLive, kycStatus = 'pending') {
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
        user={{ fullName: 'Abena', accountType: 'business_owner', kycStatus, goLive }} auth={{ isLoading: false, logout: vi.fn() }} />
    </QueryClientProvider>,
  )
}

const blocker = (code, message) => ({ code, message })
const REJECTED = blocker('kyc_rejected', 'Your application needs changes. Open your profile to see what to fix.')

describe('BusinessCommandCenter email banner', () => {
  it('shows the banner while the email is unconfirmed', async () => {
    renderDashboard({ live: false, blockers: [blocker('email_unconfirmed', 'Open the link we emailed you.')] })
    expect(await screen.findByText('Confirm your email to publish listings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument()
  })

  it('shows nothing once the business is live', async () => {
    renderDashboard({ live: true, blockers: [] })
    await screen.findByRole('heading', { name: 'Add your shop location' })
    expect(screen.queryByText('Confirm your email to publish listings')).not.toBeInTheDocument()
  })

  it('shows no email banner on a rejected application', async () => {
    renderDashboard({ live: false, blockers: [blocker('email_unconfirmed', 'Open the link.'), REJECTED] }, 'rejected')
    await screen.findByText('Your application needs changes')
    expect(screen.queryByText('Confirm your email to publish listings')).not.toBeInTheDocument()
  })
})

describe('BusinessCommandCenter go-live gate', () => {
  it('opens every tab for a KYC-pending owner the server calls live', async () => {
    renderDashboard({ live: true, blockers: [] }, 'pending')
    const tab = await screen.findByRole('button', { name: /Products/ })
    expect(tab).toBeEnabled()
    expect(screen.queryByText(/under review/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/To start listing, finish these/)).not.toBeInTheDocument()
  })

  it('lists the blockers, with no approval wait, for an owner who still has some', async () => {
    renderDashboard({ live: false, blockers: [blocker('no_pin', 'Share your shop location.'), blocker('terms_missing', 'Accept the seller terms.')] }, 'pending')
    expect(await screen.findByText('To start listing, finish these:')).toBeInTheDocument()
    expect(screen.getByText('Share your shop location.')).toBeInTheDocument()
    expect(screen.getByText('Accept the seller terms.')).toBeInTheDocument()
    expect(screen.queryByText(/under review/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/as soon as you're approved/i)).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Products/ })).toBeDisabled()
  })

  it('keeps the needs-changes presentation for a rejected application', async () => {
    renderDashboard({ live: false, blockers: [REJECTED] }, 'rejected')
    expect(await screen.findByText('Your application needs changes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fix and Resubmit' })).toBeInTheDocument()
    expect(screen.queryByText('To start listing, finish these:')).not.toBeInTheDocument()
  })

  it('a verified owner is unaffected by go-live data', async () => {
    renderDashboard({ live: true, blockers: [] }, 'verified')
    expect(await screen.findByRole('button', { name: /Products/ })).toBeEnabled()
  })
})
