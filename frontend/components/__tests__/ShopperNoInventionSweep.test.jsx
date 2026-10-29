import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../mocks/server.js'
import AccountHub from '../account/AccountHub.jsx'
import ListingDetailPage from '../ListingDetailPage.jsx'
import CartPage from '../shop/CartPage.jsx'
import CheckoutPage from '../shop/CheckoutPage.jsx'
import PaymentVerifyPage from '../shop/PaymentVerifyPage.jsx'

// Conformance sweep (Marketplace Plan 4, Task 16): every shopper page, rendered with the
// states that tempt a page to invent something (no reviews, no was-price, no co-view data,
// default MSW wallet data), must hold the no-invention and money rules.

const API = 'http://localhost:8000'
const FORBIDDEN = /Prime|Gift card|reward points|Q&A|bought in past month|Arriving|delivery on (Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i
const NOT_BUILT = 'This part of Your Payments is not available yet.'
const AMOUNT_TEXT = /^[+−-]?(GHS|GH₵) [\d,]+\.\d{2}$/
const CUSTOMER = { id: 1, fullName: 'Ama Boateng', accountType: 'customer', email: 'ama@example.com', phone: '0244000111' }

const CATEGORY = { id: 30, slug: 'fabrics', icon: '🧵', label: 'Fabrics', color: '#C8962E', kind: 'product', is_accommodation: false, is_food: false, parent: 3, ancestors: [{ id: 3, slug: 'fashion', label: 'Fashion' }] }
const GOODS = {
  id: 12, name: 'Kente Stole', description: 'Hand-woven in Bonwire.', category: CATEGORY, zone: { id: 2, name: 'Adum' },
  price_amount: '150.00', price_unit: null, tag: null, lat: null, lng: null, main_photo: `${API}/media/listings/kente.jpg`,
  photos: [], videos: [], created_at: '2026-10-01T10:00:00Z', is_promoted: false, specs: [], service_duration: '',
  avg_rating: null, review_count: 0, sale_price: null, sale_ends_at: null, was_price: null, effective_price: '150.00', discount_percent: null,
  variants: [], has_variants: false, variant_axes: [],
  business_owner: { id: 9, full_name: 'Ama Owusu', name: 'Akosua Ntoma', kyc_status: 'verified', is_ashanti_direct: false },
  has_warranty: false, warranty_details: '', has_expiry: false, expiry_date: null, return_policy: '',
  brand: '', condition: 'new', dimensions: '', weight: '', stock_quantity: 10,
  whats_included: '', requirements: '', revisions: '', delivery_time: '', cancellation_policy: 'flexible',
}
const CART = {
  id: 5, total: '300.00',
  items: [{
    id: 88, listing: 12, listing_name: 'Kente Stole', variant: 41, variant_label: 'Gold / Large', quantity: 2,
    unit_price_snapshot: '150.00', line_total: '300.00', seller_name: 'Akosua Ntoma', is_ashanti_direct: false, in_stock: true, stock_quantity: 8,
  }],
}
const GUARD = { active: true, limits: {}, shops: [], food_shops: 0, at_shop_limit: false, at_food_limit: false, checkout: { any: null, door_to_door: null } }
const SESSION = {
  reference: 'AH-3F2A9C1B', kind: 'order_checkout', amount: '265.00', purpose: 'AshantiHub Order #214', status: 'success',
  checkout_url: '', created_at: '2026-10-28T09:00:00Z', processing_fee: '5.00', wallet: false, order_id: 214,
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrap = (ui) => render(<QueryClientProvider client={client()}>{ui}</QueryClientProvider>)
const ownText = (el) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
const findPrices = (container) => Array.from(container.querySelectorAll('*')).filter((el) => AMOUNT_TEXT.test(ownText(el)))
const hub = (path) => wrap(
  <MemoryRouter initialEntries={[path]}>
    <AccountHub
      user={CUSTOMER} auth={{ requestPasswordReset: vi.fn() }} onContactSupport={vi.fn()} onRegisterBusiness={vi.fn()}
      render={{ overview: () => <div>overview</div>, orders: () => <div>orders</div>, bookings: () => null, requests: () => null, tickets: () => null, events: () => null, settings: () => null, profile: () => null, messages: () => null }}
    />
  </MemoryRouter>,
)

const dest = { id: 7, rail: 'momo', institution: 'MTN', account_name: 'Akosua Ntoma', account_number_masked: '024****567', usable_from: '2026-10-01T10:00:00Z', usable: true, removed: false }
const wd = { id: 1, reference: 'WD-1', amount: '100.00', charge: '1.00', you_receive: '99.00', status: 'processing', status_label: 'Processing', destination: dest, created_at: '2026-10-20T10:05:00Z', settled_at: null, failure_reason: '' }
const tx = (o) => ({ id: 1, at: '2026-10-18T10:30:00+00:00', account: 'wallet', kind: 'wallet_top_up', label: 'Top-up', direction: 'in', amount: '20.00', order: null, booking_sale: null, reference: '', ...o })
const envelope = (results) => HttpResponse.json({ count: results.length, next: null, previous: null, results })
// A funded wallet, so the wallet tabs have real amounts to check.
const seedWallet = () => server.use(
  http.get(`${API}/api/wallet/`, () => HttpResponse.json({ kind: 'customer', balance: '1250.50' })),
  http.get(`${API}/api/wallet/transactions/`, () => envelope([tx({ id: 1 }), tx({ id: 2, kind: 'order_payment', label: 'Order payment', direction: 'out', amount: '7.50', order: 42 })])),
  http.get(`${API}/api/wallet/destinations/`, () => HttpResponse.json({ results: [dest], cooling_hours: 24 })),
  http.get(`${API}/api/wallet/withdrawals/`, () => envelope([wd])),
)
const seeded = (path, ready) => [() => { seedWallet(); return hub(path) }, () => screen.findByText(ready)]

// [name, mount, ready anchor, whether the page must show at least one price]
const scenarios = [
  ['ProductPage (no rating, no was-price, no co-views)', () => {
    server.use(
      http.get(`${API}/api/listings/12/`, () => HttpResponse.json(GOODS)),
      http.get(`${API}/api/listings/:id/also-viewed/`, () => HttpResponse.json({ basis: 'same_category', results: [] })),
      http.get(`${API}/api/storefront/sponsored/`, () => HttpResponse.json([])),
    )
    return wrap(
      <ListingDetailPage id={12} onBack={vi.fn()} user={null} favourites={[]} onFavourite={vi.fn()} currency="GHS" onMessage={vi.fn()}
        onOpenListing={vi.fn()} onOpenSeller={vi.fn()} onAddToCart={vi.fn()} CardComponent={() => null} />,
    )
  }, () => screen.findByTestId('product-page'), true],
  ['CartPage', () => {
    server.use(
      http.get(`${API}/api/cart/`, () => HttpResponse.json(CART)),
      http.get(`${API}/api/cart/guard/`, () => HttpResponse.json(GUARD)),
      http.get(`${API}/api/storefront/sponsored/`, () => HttpResponse.json([])),
      http.get(`${API}/api/listings/:id/also-viewed/`, () => HttpResponse.json({ basis: 'same_category', results: [] })),
    )
    return wrap(<CartPage user={CUSTOMER} currency="GHS" onNavigate={vi.fn()} />)
  }, () => screen.findByRole('heading', { name: 'Shopping Cart' }), true],
  ['CheckoutPage', () => {
    server.use(
      http.get(`${API}/api/cart/`, () => HttpResponse.json(CART)),
      http.get(`${API}/api/cart/guard/`, () => HttpResponse.json(GUARD)),
      http.get(`${API}/api/accounts/addresses/`, () => HttpResponse.json([])),
    )
    return wrap(<MemoryRouter><CheckoutPage user={CUSTOMER} currency="GHS" PaymentComponent={() => null} /></MemoryRouter>)
  }, () => screen.findAllByText(/Kente Stole/), true],
  ['PaymentVerifyPage', () => {
    server.use(http.get(`${API}/api/payments/checkout-sessions/:ref/`, () => HttpResponse.json(SESSION)))
    return render(<MemoryRouter initialEntries={['/checkout/verify?reference=AH-3F2A9C1B']}><PaymentVerifyPage /></MemoryRouter>)
  }, () => screen.findByText('Payment confirmed'), true],
  ['AccountHub', () => hub('/my-account'), () => screen.findAllByTestId('account-tile'), false],
  ['Your Payments / Overview', ...seeded('/my-account/payments/overview', 'Recent activity'), true],
  ['Your Payments / Wallet', ...seeded('/my-account/payments/wallet', 'Your withdrawals'), true],
  ['Your Payments / Transactions', ...seeded('/my-account/payments/transactions', 'Order payment'), true],
  ['Your Payments / Settings', () => hub('/my-account/payments/settings'), () => screen.findByText('Your default purchase preference'), false],
]

beforeEach(() => {
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { delete window.IntersectionObserver; localStorage.clear() })

describe('shopper pages conformance sweep', () => {
  describe.each(scenarios)('%s', (name, mount, ready, priced) => {
    it('holds the no-invention and money rules', async () => {
      const { container } = mount()
      await ready()
      if (priced) await waitFor(() => expect(findPrices(container).length, 'page shows no price to check').toBeGreaterThan(0))
      await new Promise((r) => setTimeout(r, 60))
      const html = container.innerHTML
      const text = container.textContent
      expect(container.querySelectorAll('a[href^="tel:"]').length).toBe(0)
      expect(html).not.toMatch(/wa\.me/)
      expect(text).not.toMatch(FORBIDDEN)
      expect(text).not.toContain(NOT_BUILT)
      expect(text).not.toMatch(/(^|[^\d.])0\.0([^\d]|$)/)
      expect(text).not.toMatch(/NaN|undefined/)
      container.querySelectorAll('*').forEach((el) => {
        const own = ownText(el)
        if (!AMOUNT_TEXT.test(own)) return
        expect(el.closest('[style*="tabular-nums"]'), `price "${own}" needs tabular-nums`).not.toBeNull()
      })
    })
  })
})
