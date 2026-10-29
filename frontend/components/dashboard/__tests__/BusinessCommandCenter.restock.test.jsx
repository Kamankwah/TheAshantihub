import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { BusinessDashboard } from '../../../App.jsx'
import { server } from '../../../mocks/server.js'

const API = 'http://localhost:8000'
const owner = { fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }
const profile = { ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false, business_kind: 'product', has_hours: true, hours: [] }
const listing = { id: 5, name: 'Kente Cloth', status: 'published', price_amount: '100.00', price_unit: 'per item', stock_quantity: 2, has_expiry: false, expiry_date: null, specs: [], category: 1, zone: 1 }
const auth = {
  submitBusinessInfo: vi.fn(), submitPayoutInfo: vi.fn(), acceptBusinessTerms: vi.fn(), refreshUser: vi.fn(), logout: vi.fn(),
}

function setup(count) {
  const results = Array.from({ length: count }, (_, i) => ({ listing_id: i === 0 ? 5 : 100 + i, name: i === 0 ? 'Kente Cloth' : `Item ${i}`, stock: 2, basis: 'fallback', line: 5, days_of_cover: null, low: true, sold_out: false }))
  server.use(
    http.get(`${API}/api/listings/mine/`, () => HttpResponse.json([listing])),
    http.get(`${API}/api/accounts/business-owners/me/profile/`, () => HttpResponse.json(profile)),
    http.get(`${API}/api/billing/plans/`, () => HttpResponse.json([])),
    http.get(`${API}/api/billing/subscriptions/me/`, () => HttpResponse.json({})),
    http.get(`${API}/api/hero/mine/`, () => HttpResponse.json({})),
    http.get(`${API}/api/catalogue/stock/`, () => HttpResponse.json({
      count, next: null, previous: null, results, tracked_offers: count, untracked_offers: 0,
      settings: { cover_days: 7, fallback_units: 5, window_days: 28, alerts_enabled: false, sold_out_hidden: false },
    })),
  )
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BusinessDashboard onExit={vi.fn()} auth={auth} user={owner} /></QueryClientProvider>)
}

describe('Business dashboard restock entry points', () => {
  it('test_overview_card_opens_products_on_needs_restocking', async () => {
    setup(2)
    expect(await screen.findByText('2 products need restocking')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'See what needs restocking' }))
    expect(await screen.findByRole('heading', { name: 'Needs restocking' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Needs restocking \(2\)/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('test_needs_restocking_pill_shows_the_count', async () => {
    setup(3)
    fireEvent.click(await screen.findByRole('button', { name: /Products/ }))
    const pill = await screen.findByRole('button', { name: 'Needs restocking (3)' })
    expect(screen.getByRole('button', { name: 'Your products' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(pill)
    expect(await screen.findByRole('heading', { name: 'Needs restocking' })).toBeInTheDocument()
  })
})
