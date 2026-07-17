import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { StaffDashboard } from './App.jsx'
import { server } from './mocks/server.js'

// StaffDashboard's KYC/moderation panels use react-query hooks. In the real
// app the QueryClientProvider lives above App in main.jsx; these two tests
// render StaffDashboard in isolation, so they need their own client — same
// pattern as hooks/__tests__/useKYCQueue.test.jsx and useModerationQueue.test.jsx.
function renderWithQueryClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function makeAuth(overrides = {}) {
  return {
    user: {
      token: 't', account_type: 'staff', id: 1, full_name: 'Akosua Support',
      role: 'support', permissions: ['messaging.manage', 'disputes.flag', 'users.view'],
    },
    hasPermission: (codename) => ['messaging.manage', 'disputes.flag', 'users.view'].includes(codename),
    ...overrides,
  }
}

describe('StaffDashboard', () => {
  it('shows Overview by default with a greeting', () => {
    renderWithQueryClient(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    expect(screen.getByText(/Akwaaba, Akosua/)).toBeInTheDocument()
    // The "Your permissions" clutter card was removed from Overview — its
    // permission chips should no longer render.
    expect(screen.queryByText('messaging.manage')).not.toBeInTheDocument()
  })

  it('only shows nav items the session has permission for', () => {
    renderWithQueryClient(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    expect(screen.getByText('Messaging / Tickets')).toBeInTheDocument()
    expect(screen.getByText('Users')).toBeInTheDocument()
    expect(screen.queryByText('KYC Queue')).not.toBeInTheDocument()
    expect(screen.queryByText('Staff Management')).not.toBeInTheDocument()
    expect(screen.queryByText('Site Settings')).not.toBeInTheDocument()
    expect(screen.queryByText('Reviews')).not.toBeInTheDocument()
  })

  it('a super_admin-shaped session sees every nav item', () => {
    const auth = makeAuth({
      user: { token: 't', account_type: 'staff', id: 2, full_name: 'Kwame Super', role: 'super_admin', permissions: [
        'kyc.approve', 'listings.moderate', 'hero_media.approve', 'reviews.moderate', 'orders.manage_delivery', 'users.view', 'escrow.view', 'escrow.release',
        'disputes.resolve_financial', 'transactions.report', 'promotions.manage', 'analytics.view',
        'categories.manage', 'messaging.manage', 'disputes.flag', 'staff.manage', 'zones.manage',
        'site_settings.manage',
      ] },
      hasPermission: () => true,
    })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    ;['KYC Queue', 'Listings Moderation', 'Hero Approval', 'Events Moderation', 'Event Pricing', 'Reviews', 'Delivery Management', 'Users', 'Categories & Zones', 'Site Settings', 'Staff Management',
      'Escrow Ledger', 'Disputes', 'Transactions Report', 'Promotions', 'Analytics', 'Messaging / Tickets']
      .forEach((label) => expect(screen.getByText(label)).toBeInTheDocument())
  })

  it('switches to the Analytics panel and shows real marketplace counts', async () => {
    // Analytics was the last ComingSoonPanel stub; it's now a real panel
    // backed by GET /api/core/analytics/ (real-derived counts only).
    server.use(
      http.get('http://localhost:8000/api/core/analytics/', () => {
        return HttpResponse.json({
          customers: 42, business_owners: 7,
          business_owners_by_kyc: { pending: 2, verified: 4, rejected: 1 },
          listings_total: 10,
          listings_by_status: { draft: 3, pending_review: 1, published: 5, rejected: 1 },
          listings_by_kind: { product: 3, service: 2, event: 0 },
          orders_total: 8, orders_by_status: { pending: 1, paid: 6, cancelled: 1 },
          events_total: 4, events_by_status: { pending: 1, approved: 3, rejected: 0 },
        })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => ['messaging.manage', 'disputes.flag', 'users.view', 'analytics.view'].includes(c) })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Analytics'))
    expect(await screen.findByText('Customers')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
  })

  it('switches to the Messaging / Tickets panel and shows the real queue', async () => {
    server.use(
      http.get('http://localhost:8000/api/messaging/staff/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, customer: 1, business_owner: null, starter_name: 'Ama Buyer', subject: 'Order question', status: 'open', needs_reply: true, last_message_at: '2026-07-01T00:00:00Z', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' }],
        })
      }),
    )
    renderWithQueryClient(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Messaging / Tickets'))
    expect(await screen.findByText(/Ama Buyer/)).toBeInTheDocument()
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
  })

  // Promotions are self-serve (business owners purchase Featured/Boost from
  // their own dashboard — docs/BUSINESS_EVENTS_ROADMAP.md Phase 5), so this
  // panel is a lifecycle view (Active/Expired/Cancelled), never an approval
  // queue — and never the old "coming soon"/"nothing to manage" placeholder.
  it('shows a real Promotions management panel, not coming-soon or an info card', async () => {
    const auth = makeAuth({ hasPermission: (c) => c === 'promotions.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Promotions'))
    expect(await screen.findByRole('button', { name: /Active/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Expired/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cancelled/ })).toBeInTheDocument()
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Promotions are self-serve')).not.toBeInTheDocument()
    // Promotions are bought, not approved — these must never appear here.
    expect(screen.queryByRole('button', { name: /Pending/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approved/ })).not.toBeInTheDocument()
  })

  it('calls onExit when the exit button is clicked', () => {
    const onExit = vi.fn()
    renderWithQueryClient(<StaffDashboard auth={makeAuth()} onExit={onExit} />)
    fireEvent.click(screen.getByText('← Exit'))
    expect(onExit).toHaveBeenCalled()
  })

  // The admin dashboard was restyled onto the always-dark "mission-control"
  // theme (frontend/components/admin/*, matching BusinessCommandCenter's
  // convention) — the light/dark theme toggle was a deliberate removal, not
  // a regression.
  it('has no light/dark theme toggle — the dashboard is always-dark', () => {
    renderWithQueryClient(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    expect(screen.queryByTitle('Toggle theme')).not.toBeInTheDocument()
  })

  // KYC now has Pending/Approved/Rejected tabs, and Approve/Reject are gated
  // behind the Ghana Post address-verification decision (punch-list item 8):
  // the reviewer must open Details and verify the address before approving.
  it('renders the KYC queue and approves an entry after verifying the address', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/kyc/pending/', () => {
        return HttpResponse.json([{ id: 7, full_name: 'Kwame Business', login_phone: '+233201112233', created_at: '2026-07-01T00:00:00Z' }])
      }),
      http.get('http://localhost:8000/api/accounts/kyc/7/', () => {
        return HttpResponse.json({
          id: 7, full_name: 'Kwame Business', login_phone: '+233201112233', email: 'kwame@example.com',
          kyc_status: 'pending', kyc_rejection_reason: null, reviewed_by_name: null, reviewed_at: null,
          profile: { gps_address: 'AK-039-5030', business_contact_phone: '+233201112233', is_formal: false, address_verified: false, address_verified_by_name: null, address_verified_at: null },
        })
      }),
    )
    let addressVerified = false
    let approveCalled = false
    server.use(
      http.post('http://localhost:8000/api/accounts/kyc/7/address-verify/', async ({ request }) => {
        const body = await request.json()
        addressVerified = body.verified
        return HttpResponse.json({ id: 7, address_verified: body.verified, address_verified_by_name: 'Akosua Support', address_verified_at: '2026-07-02T00:00:00Z' })
      }),
      http.post('http://localhost:8000/api/accounts/kyc/7/approve/', () => {
        approveCalled = true
        return HttpResponse.json({ id: 7, kyc_status: 'verified' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'kyc.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('KYC Queue'))
    await screen.findByText('Kwame Business')
    // Approve is disabled until the address is verified.
    expect(screen.getByText('✓ Approve')).toBeDisabled()
    fireEvent.click(screen.getByText('👁️ View Details'))
    await screen.findByText('✓ Address verified')
    fireEvent.click(screen.getByText('✓ Address verified'))
    await waitFor(() => expect(addressVerified).toBe(true))
    await waitFor(() => expect(screen.getByText('✓ Approve')).toBeEnabled())
    fireEvent.click(screen.getByText('✓ Approve'))
    await waitFor(() => expect(approveCalled).toBe(true))
  })

  it('keeps KYC Approve/Reject disabled until an address decision is made', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/kyc/pending/', () => {
        return HttpResponse.json([{ id: 11, full_name: 'Abena Trader', login_phone: '+233201119999', created_at: '2026-07-01T00:00:00Z' }])
      }),
      http.get('http://localhost:8000/api/accounts/kyc/11/', () => {
        return HttpResponse.json({
          id: 11, full_name: 'Abena Trader', login_phone: '+233201119999', email: 'abena@example.com',
          kyc_status: 'pending', kyc_rejection_reason: null, reviewed_by_name: null, reviewed_at: null,
          profile: { gps_address: 'AK-100-2000', business_contact_phone: '+233201119999', is_formal: false, address_verified: false, address_verified_by_name: null, address_verified_at: null },
        })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'kyc.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('KYC Queue'))
    await screen.findByText('Abena Trader')
    expect(screen.getByText('✓ Approve')).toBeDisabled()
    expect(screen.getByText('✕ Reject')).toBeDisabled()
    fireEvent.click(screen.getByText('👁️ View Details'))
    // Still disabled after opening details but before deciding on the address.
    await screen.findByText('✓ Address verified')
    expect(screen.getByText('✓ Approve')).toBeDisabled()
  })

  it('shows KYC Approved and Rejected tabs, with re-review sending a rejected owner back to pending', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/kyc/pending/', ({ request }) => {
        const status = new URL(request.url).searchParams.get('status') || 'pending'
        if (status === 'rejected') {
          return HttpResponse.json([{ id: 20, full_name: 'Kojo Rejected', login_phone: '+233201110000', created_at: '2026-07-01T00:00:00Z', kyc_rejection_reason: 'Blurry card', reviewed_by_name: 'Akosua Support', reviewed_at: '2026-07-02T00:00:00Z' }])
        }
        return HttpResponse.json([])
      }),
    )
    let reReviewCalled = false
    server.use(
      http.post('http://localhost:8000/api/accounts/kyc/20/re-review/', () => {
        reReviewCalled = true
        return HttpResponse.json({ id: 20, kyc_status: 'pending' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'kyc.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('KYC Queue'))
    fireEvent.click(screen.getByRole('button', { name: /Rejected/ }))
    await screen.findByText('Kojo Rejected')
    expect(screen.getByText(/Blurry card/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('🔄 Review Again'))
    await waitFor(() => expect(reReviewCalled).toBe(true))
  })

  it('shows listings grouped by business, an approver on Published, and re-review on Rejected', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/moderation/pending/', ({ request }) => {
        const status = new URL(request.url).searchParams.get('status') || 'pending'
        if (status === 'approved') {
          return HttpResponse.json([{ id: 30, name: 'Verified Lodge', business_owner_name: 'Kwame Traders', category: { label: 'Hotels' }, zone: { name: 'Manhyia' }, price_amount: '450.00', contact_phone: '+233244000001', reviewed_by_name: 'Akosua Support', reviewed_at: '2026-07-02T00:00:00Z' }])
        }
        if (status === 'rejected') {
          return HttpResponse.json([{ id: 31, name: 'Bad Lodge', business_owner_name: 'Kwame Traders', category: { label: 'Hotels' }, zone: { name: 'Manhyia' }, price_amount: '99.00', contact_phone: '+233244000002', rejection_reason: 'Photos too dark' }])
        }
        return HttpResponse.json([{ id: 32, name: 'Pending Lodge', business_owner_name: 'Kwame Traders', category: { label: 'Hotels' }, zone: { name: 'Manhyia' }, price_amount: '120.00', contact_phone: '+233244000003' }])
      }),
    )
    let reReviewCalled = false
    server.use(
      http.post('http://localhost:8000/api/listings/moderation/31/re-review/', () => {
        reReviewCalled = true
        return HttpResponse.json({ id: 31, status: 'pending_review' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'listings.moderate' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Listings Moderation'))
    await screen.findByText('Pending Lodge')
    // Business grouping header (item 2).
    expect(screen.getByText('🏢 Kwame Traders')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Published/ }))
    await screen.findByText('Verified Lodge')
    expect(screen.getByText(/Published by Akosua Support/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Rejected/ }))
    await screen.findByText('Bad Lodge')
    expect(screen.getByText(/Photos too dark/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('🔄 Review Again'))
    await waitFor(() => expect(reReviewCalled).toBe(true))
  })

  it('re-reviews a rejected hero submission', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/hero/pending/', ({ request }) => {
        const status = new URL(request.url).searchParams.get('status') || 'pending'
        if (status === 'rejected') {
          return HttpResponse.json([{ id: 40, business_owner_name: 'Ama Trader', media: 'http://localhost:8000/media/hero_media/h.jpg', media_type: 'image', caption: 'Nope', submitted_at: '2026-07-01T00:00:00Z', rejection_reason: 'Off brand' }])
        }
        return HttpResponse.json([])
      }),
    )
    let reReviewCalled = false
    server.use(
      http.post('http://localhost:8000/api/listings/hero/40/re-review/', () => {
        reReviewCalled = true
        return HttpResponse.json({ id: 40, status: 'pending' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'hero_media.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Hero Approval'))
    fireEvent.click(screen.getByRole('button', { name: /Rejected/ }))
    await screen.findByText('Ama Trader')
    expect(screen.getByText(/Off brand/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('🔄 Review Again'))
    await waitFor(() => expect(reReviewCalled).toBe(true))
  })

  it('renders the listings moderation queue', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/moderation/pending/', () => {
        return HttpResponse.json([{ id: 3, name: 'Royal Ashanti Lodge', category: { label: 'Hotels' }, zone: { name: 'Manhyia' }, price_amount: '450.00', contact_phone: '+233244000001' }])
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'listings.moderate' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Listings Moderation'))
    await screen.findByText('Royal Ashanti Lodge')
  })

  it('renders the hero approval queue and approves a submission', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/hero/pending/', () => {
        return HttpResponse.json([{ id: 5, business_owner_name: 'Ama Trader', media: 'http://localhost:8000/media/hero_media/photo.jpg', media_type: 'image', caption: 'Best lodge in town', submitted_at: '2026-07-01T00:00:00Z' }])
      }),
    )
    let approveCalled = false
    server.use(
      http.post('http://localhost:8000/api/listings/hero/5/approve/', () => {
        approveCalled = true
        return HttpResponse.json({ id: 5, status: 'approved' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'hero_media.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Hero Approval'))
    await screen.findByText('Ama Trader')
    expect(screen.getByText('"Best lodge in town"')).toBeInTheDocument()
    fireEvent.click(screen.getByText('✓ Approve'))
    await waitFor(() => expect(approveCalled).toBe(true))
  })

  it('rejects a hero submission with a reason', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/hero/pending/', () => {
        return HttpResponse.json([{ id: 6, business_owner_name: 'Yaw Trader', media: 'http://localhost:8000/media/hero_media/photo2.jpg', media_type: 'image', caption: 'Fresh crafts', submitted_at: '2026-07-02T00:00:00Z' }])
      }),
    )
    let rejectBody = null
    server.use(
      http.post('http://localhost:8000/api/listings/hero/6/reject/', async ({ request }) => {
        rejectBody = await request.json()
        return HttpResponse.json({ id: 6, status: 'rejected' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'hero_media.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Hero Approval'))
    await screen.findByText('Yaw Trader')
    fireEvent.click(screen.getByText('✕ Reject'))
    fireEvent.change(screen.getByPlaceholderText('Rejection reason'), { target: { value: 'Blurry photo' } })
    fireEvent.click(screen.getByText('Confirm reject'))
    await waitFor(() => expect(rejectBody).toEqual({ reason: 'Blurry photo' }))
  })

  it('shows an inline error when approving a hero submission fails', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/hero/pending/', () => {
        return HttpResponse.json([{ id: 7, business_owner_name: 'Kofi Trader', media: 'http://localhost:8000/media/hero_media/photo3.jpg', media_type: 'image', caption: 'Kente for sale', submitted_at: '2026-07-03T00:00:00Z' }])
      }),
      http.post('http://localhost:8000/api/listings/hero/7/approve/', () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'hero_media.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Hero Approval'))
    await screen.findByText('Kofi Trader')
    fireEvent.click(screen.getByText('✓ Approve'))
    await screen.findByText('Could not approve this submission.')
  })

  it('renders the Users panel with a Customers/Business Owners tab switch', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 1, full_name: 'Ama Owusu', phone: '+233241234567', email: 'ama@example.com' }] })
      }),
      http.get('http://localhost:8000/api/accounts/business-owners/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 2, full_name: 'Kwame Business', login_phone: '+233201112233', kyc_status: 'pending' }] })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'users.view' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Users'))
    await screen.findByText('Ama Owusu')
    fireEvent.click(screen.getByText('Business Owners'))
    await screen.findByText('Kwame Business')
  })

  it('shows only zone creation for a session with zones.manage but not categories.manage', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/categories/', () => HttpResponse.json([{ id: 1, slug: 'hotels', icon: '🏨', label: 'Hotels', color: '#000080' }])),
      http.get('http://localhost:8000/api/listings/zones/', () => HttpResponse.json([{ id: 1, name: 'Manhyia' }])),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'zones.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Categories & Zones'))
    await screen.findByText('Manhyia')
    expect(screen.getByPlaceholderText('New zone name')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('New category label')).not.toBeInTheDocument()
  })

  it('creates a new zone', async () => {
    server.use(
      http.get('http://localhost:8000/api/listings/categories/', () => HttpResponse.json([])),
      http.get('http://localhost:8000/api/listings/zones/', () => HttpResponse.json([])),
    )
    let created = false
    server.use(
      http.post('http://localhost:8000/api/listings/zones/', () => { created = true; return HttpResponse.json({ id: 2, name: 'Adum' }, { status: 201 }) }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'zones.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Categories & Zones'))
    fireEvent.change(await screen.findByPlaceholderText('New zone name'), { target: { value: 'Adum' } })
    fireEvent.click(screen.getByText('Add zone'))
    await waitFor(() => expect(created).toBe(true))
  })

  it('renders the staff roster and invites a new staff member', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 1, full_name: 'Akosua Support', email: 'akosua@example.com', role: 'support', status: 'active' }] })
      }),
    )
    let invited = false
    server.use(
      http.post('http://localhost:8000/api/accounts/staff/invite/', () => { invited = true; return HttpResponse.json({ id: 2 }, { status: 201 }) }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'staff.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Staff Management'))
    await screen.findByText('Akosua Support')
    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'New Hire' } })
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'newhire@example.com' } })
    fireEvent.change(screen.getByDisplayValue('Role'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByText('Send invite'))
    await waitFor(() => expect(invited).toBe(true))
  })

  it('constrains the invite Role field to the five valid role names', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/', () => {
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'staff.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Staff Management'))
    const roleSelect = await screen.findByDisplayValue('Role')
    expect(roleSelect.tagName).toBe('SELECT')
    const optionValues = Array.from(roleSelect.querySelectorAll('option')).map((o) => o.value)
    expect(optionValues).toEqual(['', 'super_admin', 'admin', 'accountant', 'marketing', 'support'])
  })

  it('shows an inline error when approving a KYC submission fails', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/kyc/pending/', () => {
        return HttpResponse.json([{ id: 8, full_name: 'Yaw Trader', login_phone: '+233201112244', created_at: '2026-07-01T00:00:00Z' }])
      }),
      http.get('http://localhost:8000/api/accounts/kyc/8/', () => {
        return HttpResponse.json({
          id: 8, full_name: 'Yaw Trader', login_phone: '+233201112244', email: 'yaw@example.com',
          kyc_status: 'pending', kyc_rejection_reason: null, reviewed_by_name: null, reviewed_at: null,
          profile: { gps_address: 'AK-200-3000', business_contact_phone: '+233201112244', is_formal: false, address_verified: false, address_verified_by_name: null, address_verified_at: null },
        })
      }),
      http.post('http://localhost:8000/api/accounts/kyc/8/address-verify/', () => {
        return HttpResponse.json({ id: 8, address_verified: true, address_verified_by_name: 'Akosua Support', address_verified_at: '2026-07-02T00:00:00Z' })
      }),
      http.post('http://localhost:8000/api/accounts/kyc/8/approve/', () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'kyc.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('KYC Queue'))
    await screen.findByText('Yaw Trader')
    fireEvent.click(screen.getByText('👁️ View Details'))
    await screen.findByText('✓ Address verified')
    fireEvent.click(screen.getByText('✓ Address verified'))
    await waitFor(() => expect(screen.getByText('✓ Approve')).toBeEnabled())
    fireEvent.click(screen.getByText('✓ Approve'))
    await screen.findByText('Could not approve this submission. Please try again.')
  })

  it('shows an inline error when sending a staff invite fails', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/', () => {
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
      }),
      http.post('http://localhost:8000/api/accounts/staff/invite/', () => {
        return HttpResponse.json({ role: ['Not a valid choice.'] }, { status: 400 })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'staff.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Staff Management'))
    fireEvent.change(screen.getByPlaceholderText('Full name'), { target: { value: 'New Hire' } })
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'newhire@example.com' } })
    fireEvent.change(await screen.findByDisplayValue('Role'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByText('Send invite'))
    await screen.findByText('Could not send the invite. Check the details and try again.')
  })

  it('suspends a staff member with a reason (item 10)', async () => {
    let suspendBody = null
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 7, full_name: 'Kojo Staff', email: 'kojo@example.com', role: 'support', status: 'active', is_suspended: false, is_active: true, permissions: ['users.view'], role_permissions: ['users.view'] }] })
      }),
      http.post('http://localhost:8000/api/accounts/staff/7/suspend/', async ({ request }) => {
        suspendBody = await request.json()
        return HttpResponse.json({ id: 7, status: 'suspended' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'staff.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Staff Management'))
    await screen.findByText('Kojo Staff')
    fireEvent.click(screen.getByText('🚫 Suspend'))
    fireEvent.change(screen.getByPlaceholderText('Reason for suspension'), { target: { value: 'Under investigation' } })
    fireEvent.click(screen.getByText('Confirm suspend'))
    await waitFor(() => expect(suspendBody).toEqual({ reason: 'Under investigation' }))
  })

  it('deactivates a staff member (item 10)', async () => {
    let deactivateCalled = false
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 7, full_name: 'Kojo Staff', email: 'kojo@example.com', role: 'support', status: 'active', is_suspended: false, is_active: true, permissions: ['users.view'], role_permissions: ['users.view'] }] })
      }),
      http.post('http://localhost:8000/api/accounts/staff/7/deactivate/', () => {
        deactivateCalled = true
        return HttpResponse.json({ id: 7, status: 'deactivated' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'staff.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Staff Management'))
    await screen.findByText('Kojo Staff')
    fireEvent.click(screen.getByText('⏹ Deactivate'))
    await waitFor(() => expect(deactivateCalled).toBe(true))
  })

  it('grants an individual permission and sends the correct grant/revoke diff (item 9)', async () => {
    let permBody = null
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/', () => {
        // support role grants users.view; the editor should compute a grant
        // of kyc.approve (checked, not in role) and no revokes.
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 7, full_name: 'Kojo Staff', email: 'kojo@example.com', role: 'support', status: 'active', is_suspended: false, is_active: true, permissions: ['users.view'], role_permissions: ['users.view'] }] })
      }),
      http.post('http://localhost:8000/api/accounts/staff/7/permissions/', async ({ request }) => {
        permBody = await request.json()
        return HttpResponse.json({ id: 7, status: 'active' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'staff.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Staff Management'))
    await screen.findByText('Kojo Staff')
    fireEvent.click(screen.getByText('🔑 Permissions'))
    // The catalog checkbox for kyc.approve starts unchecked (not effective).
    const kycLabel = await screen.findByText('kyc.approve')
    const kycCheckbox = kycLabel.closest('label').querySelector('input[type="checkbox"]')
    expect(kycCheckbox.checked).toBe(false)
    fireEvent.click(kycCheckbox)
    fireEvent.click(screen.getByText('Save permissions'))
    await waitFor(() => expect(permBody).toEqual({ grant: ['kyc.approve'], revoke: [] }))
  })

  it('only shows the Site Settings nav item for a session with site_settings.manage', () => {
    const auth = makeAuth({ hasPermission: (c) => c === 'site_settings.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    expect(screen.getByText('Site Settings')).toBeInTheDocument()
  })

  it('renders the Site Settings form seeded with the current values', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/site-settings/', () => {
        return HttpResponse.json({
          contact_email: 'hello@ashantihub.com',
          contact_phone: '+233201112233',
          contact_address: 'Adum, Kumasi',
          facebook_url: 'https://facebook.com/ashantihub',
          instagram_url: '',
          linkedin_url: '',
          twitter_url: '',
        })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'site_settings.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Site Settings'))
    expect(await screen.findByDisplayValue('hello@ashantihub.com')).toBeInTheDocument()
    expect(screen.getByDisplayValue('+233201112233')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Adum, Kumasi')).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://facebook.com/ashantihub')).toBeInTheDocument()
  })

  it('saves Site Settings and shows a confirmation on success', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/site-settings/', () => {
        return HttpResponse.json({
          contact_email: '', contact_phone: '', contact_address: '',
          facebook_url: '', instagram_url: '', linkedin_url: '', twitter_url: '',
        })
      }),
    )
    let patchBody = null
    server.use(
      http.patch('http://localhost:8000/api/core/site-settings/', async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ ...patchBody })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'site_settings.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Site Settings'))
    await screen.findByPlaceholderText('hello@ashantihub.com')
    fireEvent.change(screen.getByPlaceholderText('hello@ashantihub.com'), { target: { value: 'new@ashantihub.com' } })
    fireEvent.change(screen.getByPlaceholderText('https://facebook.com/ashantihub'), { target: { value: 'https://facebook.com/newpage' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(patchBody).toMatchObject({
      contact_email: 'new@ashantihub.com',
      facebook_url: 'https://facebook.com/newpage',
    }))
    await screen.findByText('✓ Saved!')
  })

  it('shows an inline error when saving Site Settings fails', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/site-settings/', () => {
        return HttpResponse.json({
          contact_email: '', contact_phone: '', contact_address: '',
          facebook_url: '', instagram_url: '', linkedin_url: '', twitter_url: '',
        })
      }),
      http.patch('http://localhost:8000/api/core/site-settings/', () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'site_settings.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Site Settings'))
    await screen.findByPlaceholderText('hello@ashantihub.com')
    fireEvent.click(screen.getByText('Save'))
    await screen.findByText('Could not save site settings. Please try again.')
  })

  it('renders the two new policy fields as textareas and saves them', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/site-settings/', () => {
        return HttpResponse.json({
          contact_email: '', contact_phone: '', contact_address: '',
          facebook_url: '', instagram_url: '', linkedin_url: '', twitter_url: '',
          warranty_returns_policy: 'Returns within 7 days.',
          service_dispute_policy: 'Contact Support within 48 hours.',
        })
      }),
    )
    let patchBody = null
    server.use(
      http.patch('http://localhost:8000/api/core/site-settings/', async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ ...patchBody })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'site_settings.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Site Settings'))
    const returnsField = await screen.findByDisplayValue('Returns within 7 days.')
    expect(returnsField.tagName).toBe('TEXTAREA')
    const disputeField = screen.getByDisplayValue('Contact Support within 48 hours.')
    expect(disputeField.tagName).toBe('TEXTAREA')
    fireEvent.change(returnsField, { target: { value: 'Returns within 14 days.' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(patchBody).toMatchObject({ warranty_returns_policy: 'Returns within 14 days.' }))
    await screen.findByText('✓ Saved!')
  })
})

describe('StaffDashboard Reviews moderation', () => {
  it('only shows the Reviews nav item for a session with reviews.moderate', () => {
    const auth = makeAuth({ hasPermission: (c) => c === 'reviews.moderate' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    expect(screen.getByText('Reviews')).toBeInTheDocument()
  })

  // Reviews are pre-moderated: the queue opens on Pending and reads the
  // paginated envelope (data.results) via ModerationQueueTabs' itemsOf().
  const reviewsQueue = (byStatus) =>
    http.get('http://localhost:8000/api/reviews/moderation/', ({ request }) => {
      const status = new URL(request.url).searchParams.get('status')
      const results = byStatus[status] || []
      return HttpResponse.json({ count: results.length, next: null, previous: null, results })
    })

  it('reads the paginated pending queue (data.results) and approves a review', async () => {
    let approveCalled = false
    server.use(
      reviewsQueue({
        pending: [{ id: 1, target_type: 'listing', target_name: 'Test Lodge', rating: 5, comment: 'Great!', verified: true, author_name: 'Ama', status: 'pending', created_at: '2026-07-01T00:00:00Z' }],
      }),
      http.post('http://localhost:8000/api/reviews/moderation/1/approve/', () => {
        approveCalled = true
        return HttpResponse.json({ id: 1, status: 'published' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'reviews.moderate' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Reviews'))
    await screen.findByText('"Great!"')
    expect(screen.getByText('Test Lodge')).toBeInTheDocument()
    fireEvent.click(screen.getByText('✓ Approve'))
    await waitFor(() => expect(approveCalled).toBe(true))
  })

  it('rejects a pending review with a reason', async () => {
    let hideBody = null
    server.use(
      reviewsQueue({
        pending: [{ id: 3, target_type: 'listing', rating: 1, comment: 'Fake review', verified: false, author_name: 'Unknown', status: 'pending', created_at: '2026-07-01T00:00:00Z' }],
      }),
      http.post('http://localhost:8000/api/reviews/moderation/3/hide/', async ({ request }) => {
        hideBody = await request.json()
        return HttpResponse.json({ id: 3, status: 'hidden' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'reviews.moderate' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Reviews'))
    await screen.findByText('"Fake review"')
    fireEvent.click(screen.getByText('✕ Reject'))
    fireEvent.change(screen.getByPlaceholderText('Reason for rejecting'), { target: { value: 'Not a verified purchase' } })
    fireEvent.click(screen.getByText('Confirm reject'))
    await waitFor(() => expect(hideBody).toEqual({ reason: 'Not a verified purchase' }))
  })

  it('shows the approver on the Approved tab and allows a reactive takedown', async () => {
    server.use(
      reviewsQueue({
        approved: [{ id: 6, target_type: 'listing', rating: 5, comment: 'Lovely', verified: true, author_name: 'Ama', status: 'published', reviewed_by_name: 'Akosua Support', reviewed_at: '2026-07-02T00:00:00Z', created_at: '2026-07-01T00:00:00Z' }],
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'reviews.moderate' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Reviews'))
    fireEvent.click(await screen.findByRole('button', { name: /Approved/ }))
    await screen.findByText('"Lovely"')
    expect(screen.getByText(/Approved by Akosua Support/)).toBeInTheDocument()
    expect(screen.getByText('🚫 Hide')).toBeInTheDocument()
  })

  it('shows the rejection reason and lets a super admin send a review back for re-review', async () => {
    let reReviewCalled = false
    server.use(
      reviewsQueue({
        rejected: [{ id: 4, target_type: 'seller', rating: 3, comment: 'Meh', verified: true, author_name: 'Yaw', status: 'hidden', hidden_reason: 'Reported', reviewed_by_name: 'Akosua Support', reviewed_at: '2026-07-02T00:00:00Z', created_at: '2026-07-01T00:00:00Z' }],
      }),
      http.post('http://localhost:8000/api/reviews/moderation/4/re-review/', () => {
        reReviewCalled = true
        return HttpResponse.json({ id: 4, status: 'pending' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'reviews.moderate' || c === 'reviews.re_review' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Reviews'))
    fireEvent.click(await screen.findByRole('button', { name: /Rejected/ }))
    await screen.findByText('"Meh"')
    expect(screen.getByText(/Reported/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('🔄 Review Again'))
    await waitFor(() => expect(reReviewCalled).toBe(true))
  })

  it('hides Review Again from a moderator without reviews.re_review', async () => {
    server.use(
      reviewsQueue({
        rejected: [{ id: 4, target_type: 'seller', rating: 3, comment: 'Meh', verified: true, author_name: 'Yaw', status: 'hidden', hidden_reason: 'Reported', created_at: '2026-07-01T00:00:00Z' }],
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'reviews.moderate' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Reviews'))
    fireEvent.click(await screen.findByRole('button', { name: /Rejected/ }))
    await screen.findByText('"Meh"')
    expect(screen.queryByText('🔄 Review Again')).not.toBeInTheDocument()
    expect(screen.getByText(/Only a super admin can send a rejected review back/)).toBeInTheDocument()
  })

  it('shows an inline error when rejecting a review fails', async () => {
    server.use(
      reviewsQueue({
        pending: [{ id: 5, target_type: 'listing', rating: 1, comment: 'Bad', verified: false, author_name: 'X', status: 'pending', created_at: '2026-07-01T00:00:00Z' }],
      }),
      http.post('http://localhost:8000/api/reviews/moderation/5/hide/', () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'reviews.moderate' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Reviews'))
    await screen.findByText('"Bad"')
    fireEvent.click(screen.getByText('✕ Reject'))
    fireEvent.change(screen.getByPlaceholderText('Reason for rejecting'), { target: { value: 'spam' } })
    fireEvent.click(screen.getByText('Confirm reject'))
    await screen.findByText('Could not reject this review. Please try again.')
  })
})

describe('StaffDashboard Delivery Management', () => {
  it('only shows the Delivery Management nav item for a session with orders.manage_delivery', () => {
    const auth = makeAuth({ hasPermission: (c) => c === 'orders.manage_delivery' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    expect(screen.getByText('Delivery Management')).toBeInTheDocument()
  })

  it('reads the paginated orders queue (data.results) and only shows a delivery-status select for paid orders', async () => {
    server.use(
      http.get('http://localhost:8000/api/orders/staff/', () => {
        return HttpResponse.json({
          count: 2, next: null, previous: null,
          results: [
            { id: 1, customer: 3, customer_name: 'Ama Boateng', status: 'paid', delivery_status: 'processing', total_amount: '150.00', placed_at: '2026-07-01T00:00:00Z', items: [] },
            { id: 2, customer: 4, customer_name: 'Kofi Mensah', status: 'pending', delivery_status: 'processing', total_amount: '80.00', placed_at: '2026-07-02T00:00:00Z', items: [] },
          ],
        })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'orders.manage_delivery' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Delivery Management'))
    await screen.findByText('Ama Boateng')
    expect(screen.getByText('Kofi Mensah')).toBeInTheDocument()
    expect(screen.getAllByRole('combobox').length).toBe(1)
  })

  it('updates a paid order\'s delivery status', async () => {
    server.use(
      http.get('http://localhost:8000/api/orders/staff/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 9, customer: 3, customer_name: 'Ama Boateng', status: 'paid', delivery_status: 'processing', total_amount: '150.00', placed_at: '2026-07-01T00:00:00Z', items: [] }],
        })
      }),
    )
    let patchBody = null
    server.use(
      http.patch('http://localhost:8000/api/orders/9/delivery-status/', async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ id: 9, delivery_status: 'shipped' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'orders.manage_delivery' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Delivery Management'))
    await screen.findByText('Ama Boateng')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'shipped' } })
    await waitFor(() => expect(patchBody).toEqual({ delivery_status: 'shipped' }))
  })

  it('shows an inline error when updating delivery status fails', async () => {
    server.use(
      http.get('http://localhost:8000/api/orders/staff/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 10, customer: 3, customer_name: 'Ama Boateng', status: 'paid', delivery_status: 'processing', total_amount: '150.00', placed_at: '2026-07-01T00:00:00Z', items: [] }],
        })
      }),
      http.patch('http://localhost:8000/api/orders/10/delivery-status/', () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'orders.manage_delivery' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Delivery Management'))
    await screen.findByText('Ama Boateng')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'shipped' } })
    await screen.findByText("Could not update this order's delivery status.")
  })

  it('shows an empty state when there are no orders', async () => {
    server.use(
      http.get('http://localhost:8000/api/orders/staff/', () => {
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'orders.manage_delivery' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Delivery Management'))
    await screen.findByText('No orders yet.')
  })
})
describe('StaffDashboard Contact Messages', () => {
  it('only shows the Contact Messages nav item for a session with contact_messages.manage', () => {
    const auth = makeAuth({ hasPermission: (c) => c === 'contact_messages.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    expect(screen.getByText('Contact Messages')).toBeInTheDocument()
  })

  it('reads the paginated contact-messages queue (data.results) and shows status', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/contact-messages/', () => {
        return HttpResponse.json({
          count: 2, next: null, previous: null,
          results: [
            { id: 1, category: 'support', name: 'Ama', email: 'ama@example.com', phone: '', subject: 'Order issue', message: 'My order is late', status: 'new', resolved_by_name: null, resolved_at: null, created_at: '2026-07-01T00:00:00Z' },
            { id: 2, category: 'sales', name: 'Kofi', email: 'kofi@example.com', phone: '', subject: 'Bulk pricing', message: 'Interested in bulk pricing', status: 'resolved', resolved_by_name: 'Akosua Support', resolved_at: '2026-07-03T00:00:00Z', created_at: '2026-07-02T00:00:00Z' },
          ],
        })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'contact_messages.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Contact Messages'))
    await screen.findByText('"My order is late"')
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText('Resolved')).toBeInTheDocument()
    expect(screen.getByText(/Resolved by Akosua Support/)).toBeInTheDocument()
  })

  it('marks a message as read', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/contact-messages/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 3, category: 'general', name: 'Yaw', email: 'yaw@example.com', phone: '', subject: 'Question', message: 'How does this work?', status: 'new', resolved_by_name: null, resolved_at: null, created_at: '2026-07-01T00:00:00Z' }],
        })
      }),
    )
    let readCalled = false
    server.use(
      http.post('http://localhost:8000/api/core/contact-messages/3/read/', () => {
        readCalled = true
        return HttpResponse.json({ id: 3, status: 'read' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'contact_messages.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Contact Messages'))
    await screen.findByText('"How does this work?"')
    fireEvent.click(screen.getByText('Mark read'))
    await waitFor(() => expect(readCalled).toBe(true))
  })

  it('resolves a message', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/contact-messages/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 4, category: 'account', name: 'Abena', email: 'abena@example.com', phone: '', subject: 'Login issue', message: 'Cannot log in', status: 'read', resolved_by_name: null, resolved_at: null, created_at: '2026-07-01T00:00:00Z' }],
        })
      }),
    )
    let resolveCalled = false
    server.use(
      http.post('http://localhost:8000/api/core/contact-messages/4/resolve/', () => {
        resolveCalled = true
        return HttpResponse.json({ id: 4, status: 'resolved' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'contact_messages.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Contact Messages'))
    await screen.findByText('"Cannot log in"')
    fireEvent.click(screen.getByText('Resolve'))
    await waitFor(() => expect(resolveCalled).toBe(true))
  })

  it('hides "Mark read" once a message is resolved', async () => {
    server.use(
      http.get('http://localhost:8000/api/core/contact-messages/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 5, category: 'general', name: 'Kwabena', email: 'kwabena@example.com', phone: '', subject: 'Resolved already', message: 'This is done', status: 'resolved', resolved_by_name: 'Akosua Support', resolved_at: '2026-07-03T00:00:00Z', created_at: '2026-07-01T00:00:00Z' }],
        })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'contact_messages.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Contact Messages'))
    await screen.findByText('"This is done"')
    expect(screen.queryByText('Mark read')).not.toBeInTheDocument()
    expect(screen.queryByText('Resolve')).not.toBeInTheDocument()
  })
})

describe('StaffDashboard Events Moderation', () => {
  it('approves a pending event', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/moderation/pending/', () => {
        return HttpResponse.json([{ id: 3, name: 'Akwasidae Festival', category: { label: 'Festivals' }, zone: { name: 'Manhyia' }, visibility_days: 15, submitted_by_customer_name: 'Ama Owusu' }])
      }),
    )
    let approveCalled = false
    server.use(
      http.post('http://localhost:8000/api/events/moderation/3/approve/', () => {
        approveCalled = true
        return HttpResponse.json({ id: 3, status: 'approved' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'event.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Events Moderation'))
    await screen.findByText('Akwasidae Festival')
    fireEvent.click(screen.getByText('✓ Approve'))
    await waitFor(() => expect(approveCalled).toBe(true))
  })

  it('rejects a pending event with a reason', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/moderation/pending/', () => {
        return HttpResponse.json([{ id: 4, name: 'Secret Launch Party', category: { label: 'Festivals' }, zone: { name: 'Adum' }, visibility_days: 7, submitted_by_business_name: 'Kofi Trader' }])
      }),
    )
    let rejectBody = null
    server.use(
      http.post('http://localhost:8000/api/events/moderation/4/reject/', async ({ request }) => {
        rejectBody = await request.json()
        return HttpResponse.json({ id: 4, status: 'rejected' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'event.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Events Moderation'))
    await screen.findByText('Secret Launch Party')
    fireEvent.click(screen.getByText('✕ Reject'))
    fireEvent.change(screen.getByPlaceholderText('Rejection reason'), { target: { value: 'Missing address details' } })
    fireEvent.click(screen.getByText('Confirm reject'))
    await waitFor(() => expect(rejectBody).toEqual({ reason: 'Missing address details' }))
  })

  it('shows Approved and Rejected tabs, with re-review sending a rejected event back to pending', async () => {
    let reReviewCalled = false
    server.use(
      http.get('http://localhost:8000/api/events/moderation/pending/', ({ request }) => {
        const status = new URL(request.url).searchParams.get('status')
        if (status === 'approved') {
          return HttpResponse.json([{ id: 7, name: 'Approved Durbar', category: { label: 'Festivals' }, zone: { name: 'Adum' }, visibility_days: 14, submitted_by_business_name: 'Ama Trader', reviewed_by_name: 'Akosua Support', reviewed_at: '2026-07-02T00:00:00Z' }])
        }
        if (status === 'rejected') {
          return HttpResponse.json([{ id: 8, name: 'Rejected Gig', category: { label: 'Festivals' }, zone: { name: 'Adum' }, visibility_days: 7, submitted_by_business_name: 'Yaw Trader', rejection_reason: 'Venue unclear', reviewed_by_name: 'Akosua Support', reviewed_at: '2026-07-02T00:00:00Z' }])
        }
        return HttpResponse.json([])
      }),
      http.post('http://localhost:8000/api/events/moderation/8/re-review/', () => {
        reReviewCalled = true
        return HttpResponse.json({ id: 8, status: 'pending' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'event.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Events Moderation'))

    fireEvent.click(await screen.findByRole('button', { name: /Approved/ }))
    await screen.findByText('Approved Durbar')
    expect(screen.getByText(/Approved by Akosua Support/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Rejected/ }))
    await screen.findByText('Rejected Gig')
    expect(screen.getByText(/Venue unclear/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('🔄 Review Again'))
    await waitFor(() => expect(reReviewCalled).toBe(true))
  })
})

describe('StaffDashboard Event Pricing', () => {
  function tiersResponse(overrides = {}) {
    return [
      { id: 1, duration_days: 7, live_price: '20.00', pending_price: null, proposed_by: null, proposed_by_name: null, proposed_at: null, ...overrides },
    ]
  }

  it('an accountant can propose a new price, which stays pending until approved', async () => {
    server.use(http.get('http://localhost:8000/api/events/pricing-tiers/manage/', () => HttpResponse.json(tiersResponse())))
    let proposeBody = null
    server.use(
      http.post('http://localhost:8000/api/events/pricing-tiers/1/propose/', async ({ request }) => {
        proposeBody = await request.json()
        return HttpResponse.json(tiersResponse({ pending_price: '25.00', proposed_by_name: 'Accountant Person' })[0])
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'event_pricing.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Event Pricing'))
    await screen.findByText('7 days — GHS 20.00')
    fireEvent.change(screen.getByPlaceholderText('New price'), { target: { value: '25.00' } })
    fireEvent.click(screen.getByText('Propose'))
    await waitFor(() => expect(proposeBody).toEqual({ price: '25.00' }))
    // A super_admin-only action — an accountant session never sees it.
    expect(screen.queryByText('✓ Approve')).not.toBeInTheDocument()
  })

  it('a super_admin can approve a pending proposal', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/pricing-tiers/manage/', () =>
        HttpResponse.json(tiersResponse({ pending_price: '25.00', proposed_by_name: 'Accountant Person' })),
      ),
    )
    let approveCalled = false
    server.use(
      http.post('http://localhost:8000/api/events/pricing-tiers/1/approve/', () => {
        approveCalled = true
        return HttpResponse.json(tiersResponse({ live_price: '25.00' })[0])
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'event_pricing.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Event Pricing'))
    await screen.findByText(/Pending: GHS 25.00/)
    fireEvent.click(screen.getByText('✓ Approve'))
    await waitFor(() => expect(approveCalled).toBe(true))
    // A propose-only action — a super_admin-only session never sees it.
    expect(screen.queryByText('Propose')).not.toBeInTheDocument()
  })

  it('a super_admin can reject a pending proposal', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/pricing-tiers/manage/', () =>
        HttpResponse.json(tiersResponse({ pending_price: '25.00', proposed_by_name: 'Accountant Person' })),
      ),
    )
    let rejectCalled = false
    server.use(
      http.post('http://localhost:8000/api/events/pricing-tiers/1/reject/', () => {
        rejectCalled = true
        return HttpResponse.json(tiersResponse()[0])
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'event_pricing.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Event Pricing'))
    await screen.findByText(/Pending: GHS 25.00/)
    fireEvent.click(screen.getByText('✕ Reject'))
    await waitFor(() => expect(rejectCalled).toBe(true))
  })
})
describe('StaffDashboard Subscription Plans Management', () => {
  it('only shows the Subscription Plans nav item for a session with subscription_plans.manage', () => {
    const auth = makeAuth({ hasPermission: (c) => c === 'subscription_plans.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    expect(screen.getByText('Subscription Plans')).toBeInTheDocument()
    expect(screen.queryByText('Plan Approvals')).not.toBeInTheDocument()
  })

  it('renders the list of all plans regardless of status', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/plans/manage/', () => {
        return HttpResponse.json([
          { id: 1, tier: 'product_basic', name: 'Product Basic', kind: 'product', monthly_price: '10.00', features: ['5 listings'], is_recommended: false, status: 'active', rejection_reason: null, max_active_listings: 5, hero_days: 7, boost_credits_per_month: 0 },
          { id: 2, tier: 'product_pro', name: 'Product Pro', kind: 'product', monthly_price: '30.00', features: [], is_recommended: true, status: 'rejected', rejection_reason: 'Price too high', max_active_listings: null, hero_days: 14, boost_credits_per_month: 2 },
        ])
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'subscription_plans.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Subscription Plans'))
    await screen.findByText('Product Basic')
    expect(screen.getByText('Product Pro')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.getByText('Rejected: Price too high')).toBeInTheDocument()
    expect(screen.getByText('★ Recommended')).toBeInTheDocument()
  })

  it('creates a new plan', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/plans/manage/', () => {
        return HttpResponse.json([])
      }),
    )
    let createBody = null
    server.use(
      http.post('http://localhost:8000/api/billing/plans/manage/', async ({ request }) => {
        createBody = await request.json()
        return HttpResponse.json({ id: 3, ...createBody, status: 'pending_approval', rejection_reason: null }, { status: 201 })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'subscription_plans.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Subscription Plans'))
    await screen.findByText('Create a new plan')
    fireEvent.change(screen.getByPlaceholderText('Tier slug (e.g. product_basic)'), { target: { value: 'service_starter' } })
    fireEvent.change(screen.getByPlaceholderText('Plan name'), { target: { value: 'Service Starter' } })
    fireEvent.change(screen.getByPlaceholderText('Monthly price (GHS)'), { target: { value: '15.00' } })
    fireEvent.click(screen.getByText('Create plan'))
    await waitFor(() => expect(createBody).toEqual({
      tier: 'service_starter', name: 'Service Starter', kind: 'product', monthly_price: '15.00',
      max_active_listings: null, hero_days: 0, boost_credits_per_month: 0, is_recommended: false, features: [],
    }))
  })

  it("edits an existing plan's monthly price", async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/plans/manage/', () => {
        return HttpResponse.json([
          { id: 4, tier: 'product_basic', name: 'Product Basic', kind: 'product', monthly_price: '10.00', features: ['5 listings'], is_recommended: false, status: 'active', rejection_reason: null, max_active_listings: 5, hero_days: 7, boost_credits_per_month: 0 },
        ])
      }),
    )
    let patchBody = null
    server.use(
      http.patch('http://localhost:8000/api/billing/plans/manage/4/', async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ id: 4, ...patchBody, status: 'pending_approval', rejection_reason: null })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'subscription_plans.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Subscription Plans'))
    await screen.findByText('Product Basic')
    fireEvent.click(screen.getByText('✏️ Edit'))
    const priceInputs = screen.getAllByPlaceholderText('Monthly price (GHS)')
    fireEvent.change(priceInputs[priceInputs.length - 1], { target: { value: '12.00' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(patchBody.monthly_price).toBe('12.00'))
  })

  it('shows an inline error when creating a plan fails', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/plans/manage/', () => {
        return HttpResponse.json([])
      }),
      http.post('http://localhost:8000/api/billing/plans/manage/', () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'subscription_plans.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Subscription Plans'))
    await screen.findByText('Create a new plan')
    fireEvent.change(screen.getByPlaceholderText('Tier slug (e.g. product_basic)'), { target: { value: 'x' } })
    fireEvent.change(screen.getByPlaceholderText('Plan name'), { target: { value: 'X' } })
    fireEvent.click(screen.getByText('Create plan'))
    await screen.findByText('Could not create this plan. Check the fields and try again.')
  })
})

describe('StaffDashboard Subscription Plan Approvals', () => {
  it('only shows the Plan Approvals nav item for a session with subscription_plans.approve', () => {
    const auth = makeAuth({ hasPermission: (c) => c === 'subscription_plans.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    expect(screen.getByText('Plan Approvals')).toBeInTheDocument()
    expect(screen.queryByText('Subscription Plans')).not.toBeInTheDocument()
  })

  it('renders the pending plans queue', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/plans/pending/', () => {
        return HttpResponse.json([
          { id: 5, tier: 'service_deluxe', name: 'Service Deluxe', kind: 'service', monthly_price: '50.00', features: [], is_recommended: false, status: 'pending_approval', rejection_reason: null, max_active_listings: null, hero_days: 30, boost_credits_per_month: 5 },
        ])
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'subscription_plans.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Plan Approvals'))
    await screen.findByText('Service Deluxe')
  })

  it('approves a pending plan', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/plans/pending/', () => {
        return HttpResponse.json([
          { id: 6, tier: 'service_deluxe', name: 'Service Deluxe', kind: 'service', monthly_price: '50.00', features: [], is_recommended: false, status: 'pending_approval', rejection_reason: null, max_active_listings: null, hero_days: 30, boost_credits_per_month: 5 },
        ])
      }),
    )
    let approveCalled = false
    server.use(
      http.post('http://localhost:8000/api/billing/plans/6/approve/', () => {
        approveCalled = true
        return HttpResponse.json({ id: 6, status: 'active' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'subscription_plans.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Plan Approvals'))
    await screen.findByText('Service Deluxe')
    fireEvent.click(screen.getByText('✓ Approve'))
    await waitFor(() => expect(approveCalled).toBe(true))
  })

  it('rejects a pending plan with a reason', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/plans/pending/', () => {
        return HttpResponse.json([
          { id: 7, tier: 'service_deluxe', name: 'Service Deluxe', kind: 'service', monthly_price: '50.00', features: [], is_recommended: false, status: 'pending_approval', rejection_reason: null, max_active_listings: null, hero_days: 30, boost_credits_per_month: 5 },
        ])
      }),
    )
    let rejectBody = null
    server.use(
      http.post('http://localhost:8000/api/billing/plans/7/reject/', async ({ request }) => {
        rejectBody = await request.json()
        return HttpResponse.json({ id: 7, status: 'rejected' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'subscription_plans.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Plan Approvals'))
    await screen.findByText('Service Deluxe')
    fireEvent.click(screen.getByText('✕ Reject'))
    fireEvent.change(screen.getByPlaceholderText('Rejection reason'), { target: { value: 'Price too high for market' } })
    fireEvent.click(screen.getByText('Confirm reject'))
    await waitFor(() => expect(rejectBody).toEqual({ reason: 'Price too high for market' }))
  })

  it('shows an inline error when approving a plan fails', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/plans/pending/', () => {
        return HttpResponse.json([
          { id: 8, tier: 'service_deluxe', name: 'Service Deluxe', kind: 'service', monthly_price: '50.00', features: [], is_recommended: false, status: 'pending_approval', rejection_reason: null, max_active_listings: null, hero_days: 30, boost_credits_per_month: 5 },
        ])
      }),
      http.post('http://localhost:8000/api/billing/plans/8/approve/', () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'subscription_plans.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Plan Approvals'))
    await screen.findByText('Service Deluxe')
    fireEvent.click(screen.getByText('✓ Approve'))
    await screen.findByText('Could not approve this plan.')
  })
})

describe('StaffDashboard Overview KPIs', () => {
  // Overview has no permission gate itself, but each KPI tile's backing
  // endpoint IS gated server-side — this session only holds users.view, so
  // only the Customers/Business Owners tiles (and no others) should render,
  // and no unauthorized request should be made for the gated-off ones.
  it('only renders KPI tiles the session has permission for', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => {
        return HttpResponse.json({ count: 5, next: null, previous: null, results: [] })
      }),
      http.get('http://localhost:8000/api/accounts/business-owners/', () => {
        return HttpResponse.json({ count: 2, next: null, previous: null, results: [] })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'users.view' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    expect(screen.getByText('Customers')).toBeInTheDocument()
    expect(screen.getByText('Business Owners')).toBeInTheDocument()
    // KPI values load asynchronously (react-query) — the labels above render
    // immediately (a pure permission check), but the counts start at 0 until
    // each query resolves, so these need to be awaited separately.
    await screen.findByText('5')
    await screen.findByText('2')
    expect(screen.queryByText('Pending KYC')).not.toBeInTheDocument()
    expect(screen.queryByText('Open Disputes')).not.toBeInTheDocument()
  })

  it('shows a KYC KPI tile for a session with kyc.approve', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/kyc/pending/', () => {
        return HttpResponse.json([{ id: 1 }, { id: 2 }])
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'kyc.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    expect(screen.getByText('Pending KYC')).toBeInTheDocument()
    await screen.findByText('2')
  })
})

describe('StaffDashboard Promotions', () => {
  const promotionsQueue = (byStatus) =>
    http.get('http://localhost:8000/api/listings/promotions/', ({ request }) => {
      const status = new URL(request.url).searchParams.get('status')
      return HttpResponse.json(byStatus[status] || [])
    })

  it('lists active promotions and cancels one after confirming', async () => {
    let cancelCalled = false
    server.use(
      promotionsQueue({
        active: [{ id: 1, listing: 5, listing_name: 'Royal Lodge', business_owner_name: 'Kwame Traders', kind: 'featured', starts_at: '2026-07-01T00:00:00Z', ends_at: '2026-07-30T00:00:00Z', keywords: '', amount_paid: '5.00', status: 'active', is_currently_active: true, created_at: '2026-07-01T00:00:00Z' }],
      }),
      http.post('http://localhost:8000/api/listings/promotions/1/cancel/', () => {
        cancelCalled = true
        return HttpResponse.json({ id: 1, status: 'cancelled' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'promotions.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Promotions'))
    await screen.findByText('Royal Lodge')
    expect(screen.getByText(/Kwame Traders/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('✕ Cancel'))
    // Cancelling is not a refund — the UI must say so before confirming.
    expect(screen.getByText(/does not refund the GHS 5.00 already paid/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Confirm cancel'))
    await waitFor(() => expect(cancelCalled).toBe(true))
  })

  it('marks a paid-but-not-yet-started promotion as scheduled rather than running', async () => {
    server.use(
      promotionsQueue({
        active: [{ id: 2, listing: 5, listing_name: 'Kente Stall', business_owner_name: 'Ama Trader', kind: 'boost', starts_at: '2026-08-01T00:00:00Z', ends_at: '2026-08-08T00:00:00Z', keywords: 'kente', amount_paid: '3.00', status: 'active', is_currently_active: false, created_at: '2026-07-01T00:00:00Z' }],
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'promotions.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Promotions'))
    await screen.findByText('Kente Stall')
    expect(screen.getByText('Scheduled — not ranking yet')).toBeInTheDocument()
  })

  it('shows no cancel action on an expired promotion', async () => {
    server.use(
      promotionsQueue({
        expired: [{ id: 3, listing: 5, listing_name: 'Old Promo', business_owner_name: 'Yaw Trader', kind: 'featured', starts_at: '2026-06-01T00:00:00Z', ends_at: '2026-06-08T00:00:00Z', keywords: '', amount_paid: '5.00', status: 'active', is_currently_active: false, created_at: '2026-06-01T00:00:00Z' }],
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'promotions.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Promotions'))
    fireEvent.click(await screen.findByRole('button', { name: /Expired/ }))
    await screen.findByText('Old Promo')
    expect(screen.queryByText('✕ Cancel')).not.toBeInTheDocument()
  })
})

describe('StaffDashboard Disputes', () => {
  it('only shows the Disputes nav item for a session with disputes.flag or disputes.resolve_financial', () => {
    const auth = makeAuth({ hasPermission: (c) => c === 'disputes.flag' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    expect(screen.getByText('Disputes')).toBeInTheDocument()
  })

  it('reads the paginated disputes queue (data.results) and shows status', async () => {
    server.use(
      http.get('http://localhost:8000/api/disputes/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, order: 9, order_total_amount: '150.00', order_status: 'paid', raised_by: 3, raised_by_name: 'Ama Buyer', reason: 'delivery_issue', description: 'Never arrived.', status: 'open', resolution_notes: null, refund_amount: null, flagged_by: null, flagged_by_name: null, resolved_by: null, resolved_by_name: null, created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' }],
        })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'disputes.flag' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Disputes'))
    await screen.findByText(/Order #9/)
    expect(screen.getByText('Open')).toBeInTheDocument()
  })

  it('a disputes.flag-only session can flag an open dispute but not resolve it', async () => {
    let flagCalled = false
    server.use(
      http.get('http://localhost:8000/api/disputes/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, order: 9, order_total_amount: '150.00', order_status: 'paid', raised_by: 3, raised_by_name: 'Ama Buyer', reason: 'delivery_issue', description: 'Never arrived.', status: 'open', resolution_notes: null, refund_amount: null, flagged_by: null, flagged_by_name: null, resolved_by: null, resolved_by_name: null, created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' }],
        })
      }),
      http.post('http://localhost:8000/api/disputes/1/flag/', () => {
        flagCalled = true
        return HttpResponse.json({ id: 1, status: 'investigating' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'disputes.flag' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Disputes'))
    await screen.findByText(/Order #9/)
    expect(screen.queryByText('✓ Resolve')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('🚩 Flag'))
    await waitFor(() => expect(flagCalled).toBe(true))
  })

  it('a disputes.resolve_financial session can resolve a dispute with a refund amount', async () => {
    let resolveBody = null
    server.use(
      http.get('http://localhost:8000/api/disputes/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, order: 9, order_total_amount: '150.00', order_status: 'paid', raised_by: 3, raised_by_name: 'Ama Buyer', reason: 'delivery_issue', description: 'Never arrived.', status: 'investigating', resolution_notes: null, refund_amount: null, flagged_by: 2, flagged_by_name: 'Support Person', resolved_by: null, resolved_by_name: null, created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' }],
        })
      }),
      http.post('http://localhost:8000/api/disputes/1/resolve/', async ({ request }) => {
        resolveBody = await request.json()
        return HttpResponse.json({ id: 1, status: 'resolved' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'disputes.resolve_financial' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Disputes'))
    await screen.findByText(/Order #9/)
    fireEvent.click(screen.getByText('✓ Resolve'))
    fireEvent.change(screen.getByPlaceholderText('Refund amount (optional)'), { target: { value: '50.00' } })
    fireEvent.click(screen.getByText('Confirm resolve'))
    await waitFor(() => expect(resolveBody).toEqual({ outcome: 'resolved', refund_amount: '50.00', resolution_notes: '' }))
  })

  it('shows no actions on a terminal (resolved) dispute', async () => {
    server.use(
      http.get('http://localhost:8000/api/disputes/', ({ request }) => {
        const status = new URL(request.url).searchParams.get('status')
        const results = status === 'approved'
          ? [{ id: 1, order: 9, order_total_amount: '150.00', order_status: 'paid', raised_by: 3, raised_by_name: 'Ama Buyer', reason: 'delivery_issue', description: 'Never arrived.', status: 'resolved', resolution_notes: 'Refunded.', refund_amount: '50.00', flagged_by: 2, flagged_by_name: 'Support Person', resolved_by: 4, resolved_by_name: 'Accountant Person', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' }]
          : []
        return HttpResponse.json({ count: results.length, next: null, previous: null, results })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => ['disputes.flag', 'disputes.resolve_financial'].includes(c) })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Disputes'))
    fireEvent.click(await screen.findByRole('button', { name: /Resolved/ }))
    await screen.findByText(/Order #9/)
    expect(screen.queryByText('🚩 Flag')).not.toBeInTheDocument()
    expect(screen.queryByText('✓ Resolve')).not.toBeInTheDocument()
    expect(screen.queryByText('✕ Reject')).not.toBeInTheDocument()
    // A resolved dispute may have moved money, so it is never reopenable.
    expect(screen.queryByText('🔄 Review Again')).not.toBeInTheDocument()
  })

  it('reopens a rejected dispute from the Rejected tab', async () => {
    let reopenCalled = false
    server.use(
      http.get('http://localhost:8000/api/disputes/', ({ request }) => {
        const status = new URL(request.url).searchParams.get('status')
        const results = status === 'rejected'
          ? [{ id: 2, order: 11, order_total_amount: '80.00', order_status: 'paid', raised_by: 3, raised_by_name: 'Ama Buyer', reason: 'delivery_issue', description: 'Wrong item.', status: 'rejected', resolution_notes: 'No evidence', refund_amount: null, flagged_by: null, flagged_by_name: null, resolved_by: 4, resolved_by_name: 'Accountant Person', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-03T00:00:00Z' }]
          : []
        return HttpResponse.json({ count: results.length, next: null, previous: null, results })
      }),
      http.post('http://localhost:8000/api/disputes/2/re-review/', () => {
        reopenCalled = true
        return HttpResponse.json({ id: 2, status: 'open' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'disputes.resolve_financial' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Disputes'))
    fireEvent.click(await screen.findByRole('button', { name: /Rejected/ }))
    await screen.findByText(/Order #11/)
    expect(screen.getByText(/No evidence/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('🔄 Review Again'))
    await waitFor(() => expect(reopenCalled).toBe(true))
  })

  it('shows an inline error when flagging a dispute fails', async () => {
    server.use(
      http.get('http://localhost:8000/api/disputes/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, order: 9, order_total_amount: '150.00', order_status: 'paid', raised_by: 3, raised_by_name: 'Ama Buyer', reason: 'delivery_issue', description: 'Never arrived.', status: 'open', resolution_notes: null, refund_amount: null, flagged_by: null, flagged_by_name: null, resolved_by: null, resolved_by_name: null, created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' }],
        })
      }),
      http.post('http://localhost:8000/api/disputes/1/flag/', () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'disputes.flag' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Disputes'))
    await screen.findByText(/Order #9/)
    fireEvent.click(screen.getByText('🚩 Flag'))
    await screen.findByText('Could not flag this dispute.')
  })
})

describe('StaffDashboard Transactions Report', () => {
  it('only shows the Transactions Report nav item for a session with transactions.report', () => {
    const auth = makeAuth({ hasPermission: (c) => c === 'transactions.report' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    expect(screen.getByText('Transactions Report')).toBeInTheDocument()
  })

  it('renders the summary KPIs and status breakdown', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/transactions/report/', () => {
        return HttpResponse.json({
          summary: { count: 4, total_amount: '620.00' },
          status_breakdown: { success: { count: 3, amount: '600.00' }, refunded: { count: 1, amount: '20.00' } },
          series: [{ month: '2026-06', amount: '300.00' }, { month: '2026-07', amount: '320.00' }],
        })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'transactions.report' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Transactions Report'))
    await screen.findByText('Total Transactions')
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByText('Refunded')).toBeInTheDocument()
  })

  it('shows an inline error state when the report fails to load', async () => {
    server.use(
      http.get('http://localhost:8000/api/billing/transactions/report/', () => new HttpResponse(null, { status: 500 })),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'transactions.report' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Transactions Report'))
    await screen.findByText('Could not load the transactions report.')
  })
})

describe('StaffDashboard Messaging', () => {
  it('only shows the Messaging / Tickets nav item for a session with messaging.manage', () => {
    const auth = makeAuth({ hasPermission: (c) => c === 'messaging.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    expect(screen.getByText('Messaging / Tickets')).toBeInTheDocument()
  })

  it('expands a conversation thread and sends a reply', async () => {
    let replyBody = null
    server.use(
      http.get('http://localhost:8000/api/messaging/staff/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 5, customer: 1, business_owner: null, starter_name: 'Ama Buyer', subject: 'Order question', status: 'open', needs_reply: true, last_message_at: '2026-07-01T00:00:00Z', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' }],
        })
      }),
      http.get('http://localhost:8000/api/messaging/staff/5/', () => {
        return HttpResponse.json({
          id: 5, customer: 1, business_owner: null, starter_name: 'Ama Buyer', subject: 'Order question', status: 'open',
          messages: [{ id: 1, conversation: 5, sender_type: 'customer', body: 'Where is my order?', created_at: '2026-07-01T00:00:00Z' }],
          created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
        })
      }),
      http.post('http://localhost:8000/api/messaging/staff/5/reply/', async ({ request }) => {
        replyBody = await request.json()
        return HttpResponse.json({ id: 2, conversation: 5, sender_type: 'staff', body: replyBody.body, created_at: '2026-07-01T01:00:00Z' }, { status: 201 })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'messaging.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Messaging / Tickets'))
    await screen.findByText(/Ama Buyer/)
    fireEvent.click(screen.getByText(/Ama Buyer/))
    await screen.findByText('Where is my order?')
    fireEvent.change(screen.getByPlaceholderText('Reply as AshantiHub Support…'), { target: { value: 'It shipped yesterday!' } })
    fireEvent.click(screen.getByText('Reply'))
    await waitFor(() => expect(replyBody).toEqual({ body: 'It shipped yesterday!' }))
  })

  it('shows an inline error when the queue fails to load', async () => {
    server.use(
      http.get('http://localhost:8000/api/messaging/staff/', () => new HttpResponse(null, { status: 500 })),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'messaging.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Messaging / Tickets'))
    await screen.findByText('Could not load the messaging queue.')
  })
})

describe('StaffDashboard KYC detail view (staff dashboard review tools)', () => {
  it('expands a full detail view with Ghana card number and images before deciding', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/kyc/pending/', () => {
        return HttpResponse.json([{ id: 9, full_name: 'Kojo Applicant', login_phone: '+233207000111', created_at: '2026-01-05T10:00:00Z' }])
      }),
      http.get('http://localhost:8000/api/accounts/kyc/9/', () => {
        return HttpResponse.json({
          id: 9, full_name: 'Kojo Applicant', login_phone: '+233207000111', email: 'kojo@example.com',
          kyc_status: 'pending', kyc_rejection_reason: null,
          profile: {
            ghana_card_number: 'GHA-987654321-0', gps_address: 'AK-039-5040',
            business_contact_phone: '+233207000111', is_formal: false, business_kind: 'product',
            ghana_card_front_image: 'http://localhost:8000/media/ghana_cards/front.jpg',
            ghana_card_back_image: 'http://localhost:8000/media/ghana_cards/back.jpg',
            business_reg_certificate: null, tin: null,
          },
        })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'kyc.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('KYC Queue'))
    await screen.findByText('Kojo Applicant')
    fireEvent.click(screen.getByText('👁️ View Details'))
    await screen.findByText('GHA-987654321-0')
    // The GPS/digital address now shows both in the details grid and in the
    // Ghana Post address-verification control (punch-list item 8).
    expect(screen.getAllByText('AK-039-5040').length).toBeGreaterThan(0)
    const front = document.querySelector('img[src="http://localhost:8000/media/ghana_cards/front.jpg"]')
    expect(front).toBeTruthy()
  })
})

describe('StaffDashboard Users management (staff dashboard review tools)', () => {
  function seedUsers() {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 1, full_name: 'Ama Owusu', phone: '+233241234567', email: 'ama@example.com', is_suspended: false }] })
      }),
    )
  }

  it('suspends a customer with a reason for a session that holds users.manage', async () => {
    seedUsers()
    let suspendBody = null
    server.use(
      http.post('http://localhost:8000/api/accounts/customers/1/suspend/', async ({ request }) => {
        suspendBody = await request.json()
        return HttpResponse.json({ id: 1, is_suspended: true })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'users.view' || c === 'users.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Users'))
    await screen.findByText('Ama Owusu')
    fireEvent.click(screen.getByText('🚫 Suspend'))
    fireEvent.change(screen.getByPlaceholderText('Reason for suspension'), { target: { value: 'Fraud' } })
    fireEvent.click(screen.getByText('Confirm suspend'))
    await waitFor(() => expect(suspendBody).toEqual({ reason: 'Fraud' }))
  })

  it('shows a customer\'s real payment history and no fabricated card field (item 9)', async () => {
    seedUsers()
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/1/', () => {
        return HttpResponse.json({
          id: 1, full_name: 'Ama Owusu', phone: '+233241234567', email: 'ama@example.com', address: '12 Ash Road',
          is_suspended: false,
          payment_history: [{ kind: 'order_checkout', purpose: 'Order #5', amount: '150.00', status: 'success', created_at: '2026-07-01T00:00:00Z' }],
        })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'users.view' || c === 'users.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Users'))
    await screen.findByText('Ama Owusu')
    fireEvent.click(screen.getByText('👁️ View'))
    await screen.findByText('Payment history')
    expect(screen.getByText('Order #5')).toBeInTheDocument()
    expect(screen.getByText(/GHS 150.00/)).toBeInTheDocument()
    // No payment-instrument model exists — the panel must not claim otherwise.
    expect(screen.queryByText(/last 5 digits/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Payment type/i)).not.toBeInTheDocument()
  })

  it('shows a business owner\'s profile with the payout number masked (item 9)', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => {
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
      }),
      http.get('http://localhost:8000/api/accounts/business-owners/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 3, full_name: 'Kwame Trader', login_phone: '+233201112233', email: 'kwame@example.com', kyc_status: 'verified', is_suspended: false }] })
      }),
      http.get('http://localhost:8000/api/accounts/business-owners/3/', () => {
        return HttpResponse.json({
          id: 3, full_name: 'Kwame Trader', login_phone: '+233201112233', email: 'kwame@example.com',
          kyc_status: 'verified', is_suspended: false,
          profile: {
            business_kind: 'product', gps_address: 'AK-039-5028', tin: 'C0001234567', is_formal: true,
            address_verified: true, address_verified_by_name: 'Scout Kofi',
            default_payout_method: 'momo', payout_verification_status: 'verified',
            payout_momo_network: 'MTN', payout_momo_name: 'Kwame Trader', payout_momo_number_masked: '•••••99888',
            payout_bank_account_number_masked: null,
          },
        })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'users.view' || c === 'users.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Users'))
    fireEvent.click(await screen.findByText('Business Owners'))
    await screen.findByText('Kwame Trader')
    fireEvent.click(screen.getByText('👁️ View'))
    await screen.findByText('Payout details')
    expect(screen.getByText('•••••99888')).toBeInTheDocument()
    expect(screen.getByText('AK-039-5028')).toBeInTheDocument()
  })

  it('edits a customer and PATCHes the changed fields', async () => {
    seedUsers()
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/1/', () => {
        return HttpResponse.json({ id: 1, full_name: 'Ama Owusu', phone: '+233241234567', email: 'ama@example.com', address: '', is_suspended: false })
      }),
    )
    let patchBody = null
    server.use(
      http.patch('http://localhost:8000/api/accounts/customers/1/', async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ id: 1, ...patchBody })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'users.view' || c === 'users.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Users'))
    await screen.findByText('Ama Owusu')
    fireEvent.click(screen.getByText('✏️ Edit'))
    const nameInput = await screen.findByDisplayValue('Ama Owusu')
    fireEvent.change(nameInput, { target: { value: 'Ama Mensah' } })
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => expect(patchBody?.full_name).toBe('Ama Mensah'))
  })

  it('hides Edit/Suspend actions for a users.view-only session', async () => {
    seedUsers()
    const auth = makeAuth({ hasPermission: (c) => c === 'users.view' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Users'))
    await screen.findByText('Ama Owusu')
    expect(screen.queryByText('✏️ Edit')).not.toBeInTheDocument()
    expect(screen.queryByText('🚫 Suspend')).not.toBeInTheDocument()
    expect(screen.getByText('👁️ View')).toBeInTheDocument()
  })

  it('shows a Suspended badge and an Unsuspend action for an already-suspended user', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => {
        return HttpResponse.json({ count: 1, next: null, previous: null, results: [{ id: 2, full_name: 'Yaw Banned', phone: '+233200000000', email: '', is_suspended: true }] })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'users.view' || c === 'users.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Users'))
    await screen.findByText('Yaw Banned')
    expect(screen.getByText('Suspended')).toBeInTheDocument()
    expect(screen.getByText('↩️ Unsuspend')).toBeInTheDocument()
  })
})

describe('StaffDashboard Events Moderation detail view (staff dashboard review tools)', () => {
  it('expands a read-only detail view with description and venue before deciding', async () => {
    server.use(
      http.get('http://localhost:8000/api/events/moderation/pending/', () => {
        return HttpResponse.json([{ id: 3, name: 'Akwasidae Festival', category: { label: 'Festivals' }, zone: { name: 'Manhyia' }, visibility_days: 15, submitted_by_customer_name: 'Ama Owusu' }])
      }),
      http.get('http://localhost:8000/api/events/moderation/3/', () => {
        return HttpResponse.json({
          id: 3, name: 'Akwasidae Festival', description: 'Royal durbar at the palace.',
          category: { label: 'Festivals' }, zone: { name: 'Manhyia' }, address: 'Manhyia Palace, Kumasi',
          event_date: '2026-09-01T14:00:00Z', visibility_days: 15, access_level: 'public',
          lat: '6.70', lng: '-1.62', submitted_by_customer_name: 'Ama Owusu', media: [],
        })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'event.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Events Moderation'))
    await screen.findByText('Akwasidae Festival')
    fireEvent.click(screen.getByText('👁️ View'))
    await screen.findByText('Royal durbar at the palace.')
    expect(screen.getByText('Manhyia Palace, Kumasi')).toBeInTheDocument()
  })
})
