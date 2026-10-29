import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import BusinessCommandCenter from '../../dashboard/BusinessCommandCenter.jsx'
import ProductLookupPanel from '../ProductLookupPanel.jsx'

const API = 'http://localhost:8000'
const offer = (o) => ({
  listing_id: 11, name: 'Milo', price_amount: '1300.00', price_now: '1250.00', price_basis: 'discount', price_unit: 'per tin',
  condition: 'new', business_name: 'Kofi Stores', verified: true, zone: 'Adum', available_quantity: 7, ...o,
})
const product = { id: 1, brand: 'Milo', name: 'Tin 400g', barcode: '06001234567890', offer_count: 1, lowest_price: '1250.00' }

function setup({ offers = [offer()], your = [], listings = [], offersResponse } = {}) {
  server.use(
    http.get(`${API}/api/catalogue/products/`, () => HttpResponse.json({ results: [product], truncated: false })),
    http.get(`${API}/api/catalogue/products/:id/offers/`, () => offersResponse ? offersResponse() : HttpResponse.json({
      catalogue_product: product, your_listings: your, offers, truncated: false,
    })),
    http.get(`${API}/api/listings/mine/`, () => HttpResponse.json(listings)),
  )
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ProductLookupPanel /></QueryClientProvider>)
}
async function open() {
  fireEvent.change(screen.getByLabelText('Product name or barcode'), { target: { value: 'milo' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  fireEvent.click(await screen.findByRole('button', { name: 'See offers' }))
}

describe('ProductLookupPanel', () => {
  it('test_offers_show_name_verified_mark_price_and_count', async () => {
    setup()
    await open()
    expect(await screen.findByText('Kofi Stores')).toBeInTheDocument()
    expect(screen.getByText('✓ Verified business')).toBeInTheDocument()
    expect(screen.getAllByText(/GH₵ 1,250\.00/).length).toBeGreaterThan(0)
    expect(screen.getByText(/per tin/)).toBeInTheDocument()
    expect(screen.getByText('Discounted price')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText('Adum')).toBeInTheDocument()
    expect(screen.getByText('7 available')).toBeInTheDocument()
  })

  it('test_null_business_name_and_uncounted_stock_are_said_plainly', async () => {
    setup({ offers: [offer({ business_name: null, available_quantity: null, price_basis: 'regular' })] })
    await open()
    expect(await screen.findByText('Business name not given')).toBeInTheDocument()
    expect(screen.getByText('Stock not counted')).toBeInTheDocument()
  })

  it('test_your_own_listings_are_named', async () => {
    setup({ your: [4, 9], listings: [{ id: 4, name: 'My Milo' }, { id: 9, name: 'Milo big' }, { id: 5, name: 'Other' }] })
    await open()
    expect(await screen.findByText('You sell this product too: My Milo, Milo big')).toBeInTheDocument()
  })

  it('test_offers_carry_no_contact_links', async () => {
    setup()
    await open()
    await screen.findByText('Kofi Stores')
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(document.querySelector('a[href^="tel:"], a[href*="wa.me"], a[href^="mailto:"]')).toBeNull()
  })

  it('test_suspended_account_sees_the_server_refusal', async () => {
    setup({ offersResponse: () => HttpResponse.json({ detail: 'Your account is suspended.', code: 'account_suspended' }, { status: 403 }) })
    await open()
    expect(await screen.findByText('Your account is suspended.')).toBeInTheDocument()
  })

  it('test_lookup_tab_only_for_a_product_business', async () => {
    const owner = { fullName: 'Abena', accountType: 'business_owner', kycStatus: 'verified' }
    const auth = { logout: vi.fn(), refreshUser: vi.fn() }
    const base = { ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false, hours: [], has_hours: true }
    for (const [kind, expected] of [['product', true], ['service', false]]) {
      server.use(
        http.get(`${API}/api/listings/mine/`, () => HttpResponse.json([])),
        http.get(`${API}/api/accounts/business-owners/me/profile/`, () => HttpResponse.json({ ...base, business_kind: kind })),
        http.get(`${API}/api/billing/plans/`, () => HttpResponse.json([])),
        http.get(`${API}/api/billing/subscriptions/me/`, () => HttpResponse.json({})),
        http.get(`${API}/api/hero/mine/`, () => HttpResponse.json({})),
      )
      const { unmount } = render(
        <QueryClientProvider client={new QueryClient()}>
          <BusinessCommandCenter onExit={vi.fn()} user={owner} auth={auth} PaymentComponent={() => null} />
        </QueryClientProvider>,
      )
      if (expected) expect(await screen.findByRole('button', { name: /Product lookup/ })).toBeInTheDocument()
      else {
        await screen.findAllByRole('button', { name: /Listings/ })
        await waitFor(() => expect(screen.queryByRole('button', { name: /Product lookup/ })).not.toBeInTheDocument())
        await screen.findByRole('button', { name: /Services/ })
      }
      unmount()
    }
  })
})
