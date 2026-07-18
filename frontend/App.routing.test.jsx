import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import AshantiHub from './App.jsx'
import { setStoredAuth } from './apiClient.js'
import { server } from './mocks/server.js'

// docs/UI_MODERNIZATION_ROADMAP.md Phase D — real URL sync for `page`.
// Before this phase, `page` was a bare useState with zero connection to
// window.location, so visiting /business directly (or hard-reloading while
// on it) always bounced to Home. These tests mount the real default-exported
// AshantiHub (not just Navbar in isolation — Navbar.test.jsx already covers
// that setPage gets called with the right string) inside a router, to prove
// the URL <-> page wiring itself actually works end to end.
//
// AshantiHub shows a ~1.8s simulated boot LoadingScreen before anything else
// (including Navbar) renders, and fires a real (MSW-mocked) useListings/
// useCategories/useZones/useEvents fetch unconditionally on mount regardless
// of which page is active — so every test here needs a generous findBy
// timeout and the shared MSW handlers (mocks/handlers.js), not a stripped-
// down fetch mock.

function renderAtPath(path) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AshantiHub />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AshantiHub routing', () => {
  it(
    'mounts at "/" and shows the Home tab',
    async () => {
      renderAtPath('/')
      expect(await screen.findByText(/Ashanti Rising/i, {}, { timeout: 3000 })).toBeInTheDocument()
    },
    8000,
  )

  it(
    'mounting directly at /business (simulating a hard reload) renders the Business tab, not Home',
    async () => {
      renderAtPath('/business')
      expect(
        await screen.findByText(/business contact is handled by AshantiHub Support/i, {}, { timeout: 3000 }),
      ).toBeInTheDocument()
      expect(screen.queryByText(/Ashanti Rising/i)).not.toBeInTheDocument()
    },
    8000,
  )

  it(
    'mounting directly at /events (simulating a hard reload) renders the Events tab, not Home',
    async () => {
      renderAtPath('/events')
      expect(
        await screen.findByText(/Plan your visit around Kumasi's cultural calendar/i, {}, { timeout: 3000 }),
      ).toBeInTheDocument()
      expect(screen.queryByText(/business contact is handled by AshantiHub Support/i)).not.toBeInTheDocument()
    },
    8000,
  )

  it(
    'an unmatched path renders the 404 page instead of Home',
    async () => {
      renderAtPath('/this-page-does-not-exist')
      expect(await screen.findByText('Page Not Found', {}, { timeout: 3000 })).toBeInTheDocument()
    },
    8000,
  )

  it(
    'clicking the Business nav link (a real setPage("business") call) updates window.location to /business',
    async () => {
      // Real BrowserRouter (not MemoryRouter) so window.location can be
      // asserted against directly — this is the same setPage prop Navbar
      // receives and calls unmodified (see Navbar.jsx/Navbar.test.jsx), now
      // backed by useNavigate() instead of a bare useState setter.
      window.history.pushState({}, '', '/')
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      render(
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AshantiHub />
          </BrowserRouter>
        </QueryClientProvider>,
      )

      // The Business nav link is labelled "Adwaso" (route stays /business).
      await screen.findByText('Adwaso', {}, { timeout: 3000 })
      fireEvent.click(screen.getAllByText('Adwaso')[0])
      expect(window.location.pathname).toBe('/business')

      window.history.pushState({}, '', '/')
    },
    8000,
  )
})

// A follow-up Phase-D slice — showBizDash/showPayments/showCredit/
// selectedListingId/selectedEventId were originally scoped out as local
// state (see the comment above PATH_TO_PAGE in App.jsx); this section
// extends the routing coverage above to those paths too, using the same
// renderAtPath(MemoryRouter) helper.
describe('AshantiHub routing — dashboard and detail routes', () => {
  it(
    // Fixed alongside the /business-dashboard 401-spam bug: this route used
    // to render BusinessDashboard (and fire its business-owner-scoped
    // queries) for anyone, signed in or not. It now gates on an actual
    // business-owner session, same as /staff already gated on a staff one.
    'mounting directly at /business-dashboard while signed out shows a sign-in prompt, not the dashboard',
    async () => {
      // useSubscriptionPlans() hits a public (AllowAny) endpoint, so unlike
      // this dashboard's other data hooks it isn't gated on being signed in
      // as a business owner — it still fires here, so it needs a handler.
      server.use(
        http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
      )
      renderAtPath('/business-dashboard')
      expect(
        await screen.findByText(/Sign in with a business owner account/i, {}, { timeout: 3000 }),
      ).toBeInTheDocument()
      expect(screen.queryByText('Business Dashboard')).not.toBeInTheDocument()
    },
    8000,
  )

  it(
    'mounting directly at /business-dashboard as a signed-in business owner renders BusinessDashboard directly',
    async () => {
      setStoredAuth({ token: 'test-token', account_type: 'business_owner', id: 1, full_name: 'Abena' })
      server.use(
        http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({
          account_type: 'business_owner', id: 1, full_name: 'Abena',
          kyc_status: 'verified', kyc_rejection_reason: null, registration_step: 'complete',
        })),
        http.get('http://localhost:8000/api/listings/mine/', () => HttpResponse.json([])),
        http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json({})),
        http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
        http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({})),
        http.get('http://localhost:8000/api/hero/mine/', () => HttpResponse.json({})),
      )
      try {
        renderAtPath('/business-dashboard')
        // The three former dashboards (Business/Payments/Credit) are now one
        // unified Business Command Center; /business-dashboard, /payments and
        // /credit all deep-link into it (Payments/Credit as tabs). The shell
        // header is the hard-reload-safe routing signal shared by all three.
        expect(await screen.findByText('Business Command Center', {}, { timeout: 3000 })).toBeInTheDocument()
      } finally {
        setStoredAuth(null)
      }
    },
    8000,
  )

  it(
    'mounting directly at /payments (simulating a hard reload) renders the Business Command Center',
    async () => {
      // Same business-owner-session gate as /business-dashboard above — now
      // that Payments/Credit are tabs of the same unified BusinessCommandCenter,
      // they share its "don't render for a signed-out visitor" fix too.
      setStoredAuth({ token: 'test-token', account_type: 'business_owner', id: 1, full_name: 'Abena' })
      server.use(
        http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({
          account_type: 'business_owner', id: 1, full_name: 'Abena',
          kyc_status: 'verified', kyc_rejection_reason: null, registration_step: 'complete',
        })),
        http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json({})),
        http.get('http://localhost:8000/api/billing/transactions/mine/', () => HttpResponse.json([])),
        http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
        http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({})),
      )
      try {
        renderAtPath('/payments')
        expect(await screen.findByText('Business Command Center', {}, { timeout: 3000 })).toBeInTheDocument()
      } finally {
        setStoredAuth(null)
      }
    },
    8000,
  )

  it(
    'mounting directly at /credit (simulating a hard reload) renders the Business Command Center',
    async () => {
      setStoredAuth({ token: 'test-token', account_type: 'business_owner', id: 1, full_name: 'Abena' })
      server.use(
        http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({
          account_type: 'business_owner', id: 1, full_name: 'Abena',
          kyc_status: 'verified', kyc_rejection_reason: null, registration_step: 'complete',
        })),
        http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json({})),
        http.get('http://localhost:8000/api/credit/scores/me/', () => HttpResponse.json({ score: 620, loan_eligible: true })),
      )
      try {
        renderAtPath('/credit')
        expect(await screen.findByText('Business Command Center', {}, { timeout: 3000 })).toBeInTheDocument()
      } finally {
        setStoredAuth(null)
      }
    },
    8000,
  )

  it(
    // Replaces an older 'renders UserPanel directly' test that mounted this
    // route with no session at all — it pinned the very bug fixed here: the
    // page rendered for anyone, so its tab panels fired customer-scoped
    // queries (GET /api/orders/, GET /api/events/tickets/mine/, both
    // [IsAuthenticated, IsCustomer]) with no token and spammed 401s. Same
    // signed-out/signed-in pair the /business-dashboard bug above got; the
    // "hard reload doesn't bounce to Home" intent it covered is kept below.
    'mounting directly at /my-account while signed out shows a sign-in prompt, not the account page',
    async () => {
      let customerScopedCalls = 0
      server.use(
        http.get('http://localhost:8000/api/orders/', () => {
          customerScopedCalls += 1
          return new HttpResponse(null, { status: 401 })
        }),
        http.get('http://localhost:8000/api/events/tickets/mine/', () => {
          customerScopedCalls += 1
          return new HttpResponse(null, { status: 401 })
        }),
      )
      renderAtPath('/my-account')
      expect(
        await screen.findByText(/Sign in with a customer account/i, {}, { timeout: 3000 }),
      ).toBeInTheDocument()
      expect(screen.queryByText('My Account')).not.toBeInTheDocument()
      expect(customerScopedCalls).toBe(0)
    },
    8000,
  )

  it(
    'mounting directly at /my-account (simulating a hard reload) as a signed-in customer renders UserPanel directly',
    async () => {
      setStoredAuth({ token: 'test-token', account_type: 'customer', id: 1, full_name: 'Ama Owusu' })
      server.use(
        http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({
          account_type: 'customer', id: 1, full_name: 'Ama Owusu', registration_step: 'complete',
        })),
        http.get('http://localhost:8000/api/orders/', () => HttpResponse.json([])),
        http.get('http://localhost:8000/api/events/tickets/mine/', () => HttpResponse.json([])),
      )
      try {
        renderAtPath('/my-account')
        expect(await screen.findByText('My Account', {}, { timeout: 3000 })).toBeInTheDocument()
        expect(screen.queryByText(/Ashanti Rising/i)).not.toBeInTheDocument()
      } finally {
        setStoredAuth(null)
      }
    },
    8000,
  )

  it(
    'mounting directly at /business/123 renders the Business tab AND opens ListingDetailPage for id 123',
    async () => {
      server.use(
        http.get('http://localhost:8000/api/listings/123/', () =>
          HttpResponse.json({
            id: 123, name: 'Ama\'s Lodge', description: 'A lovely stay.', price_amount: '450.00',
            price_unit: 'per night', photos: [], main_photo: null, category: { color: '#000080' },
          }),
        ),
        http.get('http://localhost:8000/api/listings/123/related/', () => HttpResponse.json([])),
      )
      renderAtPath('/business/123')
      expect(await screen.findByText(/Ama's Lodge/i, {}, { timeout: 3000 })).toBeInTheDocument()
      // The surrounding Business-tab chrome (support-contact banner) stays mounted
      // around the PDP, same "scoped swap" convention as before this slice.
      expect(screen.queryByText(/Ashanti Rising/i)).not.toBeInTheDocument()
    },
    8000,
  )

  it(
    'mounting directly at /events/456 renders the Events tab AND opens EventDetailPage for id 456',
    async () => {
      server.use(
        http.get('http://localhost:8000/api/events/456/', () =>
          HttpResponse.json({
            id: 456, name: 'Akwasidae Festival', description: 'A cultural celebration.',
            event_date: '2026-08-01T10:00:00Z', address: 'Manhyia Palace', media: [],
          }),
        ),
      )
      renderAtPath('/events/456')
      expect(await screen.findByText(/Akwasidae Festival/i, {}, { timeout: 3000 })).toBeInTheDocument()
    },
    8000,
  )

  it(
    'clicking ListingDetailPage\'s "Back to results" navigates the URL from /business/123 back to /business',
    async () => {
      window.history.pushState({}, '', '/business/123')
      server.use(
        http.get('http://localhost:8000/api/listings/123/', () =>
          HttpResponse.json({
            id: 123, name: 'Ama\'s Lodge', description: 'A lovely stay.', price_amount: '450.00',
            price_unit: 'per night', photos: [], main_photo: null, category: { color: '#000080' },
          }),
        ),
        http.get('http://localhost:8000/api/listings/123/related/', () => HttpResponse.json([])),
      )
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      render(
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AshantiHub />
          </BrowserRouter>
        </QueryClientProvider>,
      )
      await screen.findByText(/Ama's Lodge/i, {}, { timeout: 3000 })
      fireEvent.click(screen.getByText('‹ Back to results'))
      expect(window.location.pathname).toBe('/business')

      window.history.pushState({}, '', '/')
    },
    8000,
  )

  it(
    'clicking EventDetailPage\'s "Back to events" navigates the URL from /events/456 back to /events',
    async () => {
      window.history.pushState({}, '', '/events/456')
      server.use(
        http.get('http://localhost:8000/api/events/456/', () =>
          HttpResponse.json({
            id: 456, name: 'Akwasidae Festival', description: 'A cultural celebration.',
            event_date: '2026-08-01T10:00:00Z', address: 'Manhyia Palace', media: [],
          }),
        ),
      )
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      render(
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AshantiHub />
          </BrowserRouter>
        </QueryClientProvider>,
      )
      await screen.findByText(/Akwasidae Festival/i, {}, { timeout: 3000 })
      fireEvent.click(screen.getByText('‹ Back to events'))
      expect(window.location.pathname).toBe('/events')

      window.history.pushState({}, '', '/')
    },
    8000,
  )
})

// GET /api/messaging/conversations/ admits only Customer/BusinessOwner
// (messaging/views.py's IsCustomerOrBusinessOwner) — a staff session is
// signed in but holds no customer-facing inbox of its own (staff read the
// same threads through the admin MessagingPanel's /api/messaging/staff/
// instead). Both call sites used to gate this query on merely being signed
// in (`!!user`), so every staff page load fired a guaranteed 403 — four
// times over, since React Query retries a failed query 3x by default.
describe('AshantiHub — messaging queries for a staff session', () => {
  it(
    'does not fetch the customer/business-owner conversations endpoint for a staff session',
    async () => {
      let conversationCalls = 0
      setStoredAuth({ token: 'test-token', account_type: 'staff', id: 1, full_name: 'Akosua Support' })
      server.use(
        http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({
          account_type: 'staff', id: 1, full_name: 'Akosua Support',
          role: 'support', permissions: ['messaging.manage', 'users.view'],
        })),
        http.get('http://localhost:8000/api/messaging/conversations/', () => {
          conversationCalls += 1
          return new HttpResponse(null, { status: 403 })
        }),
      )
      try {
        renderAtPath('/staff')
        expect(await screen.findByText(/Akwaaba, Akosua/i, {}, { timeout: 3000 })).toBeInTheDocument()
        expect(conversationCalls).toBe(0)
      } finally {
        setStoredAuth(null)
      }
    },
    8000,
  )
})

// Hubtel integration (docs/HUBTEL_INTEGRATION.md, plan Workstream E) — the
// page a customer/business owner lands back on after Hubtel's hosted
// checkout. Unexercised in real usage until real Hubtel credentials exist,
// but the route/page itself is real and hard-reload-safe like every other
// page in this file, so it gets the same routing coverage.
describe('AshantiHub routing — /payment/return', () => {
  it(
    'mounting directly at /payment/return polls the checkout session and shows a success state',
    async () => {
      server.use(
        http.get('http://localhost:8000/api/payments/checkout-sessions/AH-TEST-REF/', () =>
          HttpResponse.json({
            reference: 'AH-TEST-REF', kind: 'order_checkout', amount: '150.00',
            purpose: 'AshantiHub Order #1', status: 'success', checkout_url: null,
            created_at: '2026-07-15T10:00:00Z',
          }),
        ),
      )
      renderAtPath('/payment/return?reference=AH-TEST-REF')
      expect(await screen.findByText(/Payment Successful/i, {}, { timeout: 3000 })).toBeInTheDocument()
    },
    8000,
  )

  it(
    'mounting directly at /payment/return with no ?reference= shows an error, not a Home bounce',
    async () => {
      renderAtPath('/payment/return')
      expect(
        await screen.findByText(/No payment reference found/i, {}, { timeout: 3000 }),
      ).toBeInTheDocument()
      expect(screen.queryByText(/Ashanti Rising/i)).not.toBeInTheDocument()
    },
    8000,
  )
})
