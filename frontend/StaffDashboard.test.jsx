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
  it('shows Overview by default with a greeting and the session permissions', () => {
    renderWithQueryClient(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    expect(screen.getByText(/Akwaaba, Akosua/)).toBeInTheDocument()
    expect(screen.getByText('messaging.manage')).toBeInTheDocument()
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

  it('switches panels on nav click and shows a coming-soon message for unbuilt permissions', () => {
    // Disputes/Transactions Report/Messaging all went from ComingSoonPanel
    // stubs to real panels (system-admin-dashboard real-data wiring) —
    // Analytics is the one remaining unbuilt tab, so this test now exercises
    // that one instead of Messaging.
    const auth = makeAuth({ hasPermission: (c) => ['messaging.manage', 'disputes.flag', 'users.view', 'analytics.view'].includes(c) })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Analytics'))
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
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

  // Promotions went self-serve (business owners purchase Featured/Boost from
  // their own dashboard — docs/BUSINESS_EVENTS_ROADMAP.md Phase 5), so the
  // old ComingSoonPanel placeholder here would now be misleading. Assert the
  // informational panel shows instead, not "coming soon".
  it('shows a self-serve informational panel for Promotions instead of coming-soon', () => {
    const auth = makeAuth({ hasPermission: (c) => c === 'promotions.manage' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Promotions'))
    expect(screen.getByText('Promotions are self-serve')).toBeInTheDocument()
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
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

  it('renders the KYC queue and approves an entry', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/kyc/pending/', () => {
        return HttpResponse.json([{ id: 7, full_name: 'Kwame Business', login_phone: '+233201112233', created_at: '2026-07-01T00:00:00Z' }])
      }),
    )
    let approveCalled = false
    server.use(
      http.post('http://localhost:8000/api/accounts/kyc/7/approve/', () => {
        approveCalled = true
        return HttpResponse.json({ id: 7, kyc_status: 'verified' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'kyc.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('KYC Queue'))
    await screen.findByText('Kwame Business')
    fireEvent.click(screen.getByText('✓ Approve'))
    await waitFor(() => expect(approveCalled).toBe(true))
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
      http.post('http://localhost:8000/api/accounts/kyc/8/approve/', () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'kyc.approve' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('KYC Queue'))
    await screen.findByText('Yaw Trader')
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

  it('reads the paginated moderation queue (data.results) and shows published/hidden status', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/moderation/', () => {
        return HttpResponse.json({
          count: 2, next: null, previous: null,
          results: [
            { id: 1, target_type: 'listing', rating: 5, comment: 'Great!', verified: true, author_name: 'Ama', status: 'published', created_at: '2026-07-01T00:00:00Z' },
            { id: 2, target_type: 'event', rating: 2, comment: 'Poorly organized', verified: true, author_name: 'Kofi', status: 'hidden', hidden_reason: 'Spam', created_at: '2026-07-02T00:00:00Z' },
          ],
        })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'reviews.moderate' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Reviews'))
    await screen.findByText('"Great!"')
    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(screen.getByText('Hidden')).toBeInTheDocument()
    expect(screen.getByText('Hidden: Spam')).toBeInTheDocument()
  })

  it('hides a published review with a reason', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/moderation/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 3, target_type: 'listing', rating: 1, comment: 'Fake review', verified: false, author_name: 'Unknown', status: 'published', created_at: '2026-07-01T00:00:00Z' }],
        })
      }),
    )
    let hideBody = null
    server.use(
      http.post('http://localhost:8000/api/reviews/moderation/3/hide/', async ({ request }) => {
        hideBody = await request.json()
        return HttpResponse.json({ id: 3, status: 'hidden' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'reviews.moderate' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Reviews'))
    await screen.findByText('"Fake review"')
    fireEvent.click(screen.getByText('🚫 Hide'))
    fireEvent.change(screen.getByPlaceholderText('Reason for hiding'), { target: { value: 'Not a verified purchase' } })
    fireEvent.click(screen.getByText('Confirm hide'))
    await waitFor(() => expect(hideBody).toEqual({ reason: 'Not a verified purchase' }))
  })

  it('unhides a hidden review', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/moderation/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 4, target_type: 'seller', rating: 3, comment: 'Meh', verified: true, author_name: 'Yaw', status: 'hidden', hidden_reason: 'Reported', created_at: '2026-07-01T00:00:00Z' }],
        })
      }),
    )
    let unhideCalled = false
    server.use(
      http.post('http://localhost:8000/api/reviews/moderation/4/unhide/', () => {
        unhideCalled = true
        return HttpResponse.json({ id: 4, status: 'published' })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'reviews.moderate' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Reviews'))
    await screen.findByText('"Meh"')
    fireEvent.click(screen.getByText('↩️ Unhide'))
    await waitFor(() => expect(unhideCalled).toBe(true))
  })

  it('shows an inline error when hiding a review fails', async () => {
    server.use(
      http.get('http://localhost:8000/api/reviews/moderation/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 5, target_type: 'listing', rating: 1, comment: 'Bad', verified: false, author_name: 'X', status: 'published', created_at: '2026-07-01T00:00:00Z' }],
        })
      }),
      http.post('http://localhost:8000/api/reviews/moderation/5/hide/', () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => c === 'reviews.moderate' })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Reviews'))
    await screen.findByText('"Bad"')
    fireEvent.click(screen.getByText('🚫 Hide'))
    fireEvent.change(screen.getByPlaceholderText('Reason for hiding'), { target: { value: 'spam' } })
    fireEvent.click(screen.getByText('Confirm hide'))
    await screen.findByText('Could not hide this review.')
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
      http.get('http://localhost:8000/api/disputes/', () => {
        return HttpResponse.json({
          count: 1, next: null, previous: null,
          results: [{ id: 1, order: 9, order_total_amount: '150.00', order_status: 'paid', raised_by: 3, raised_by_name: 'Ama Buyer', reason: 'delivery_issue', description: 'Never arrived.', status: 'resolved', resolution_notes: 'Refunded.', refund_amount: '50.00', flagged_by: 2, flagged_by_name: 'Support Person', resolved_by: 4, resolved_by_name: 'Accountant Person', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' }],
        })
      }),
    )
    const auth = makeAuth({ hasPermission: (c) => ['disputes.flag', 'disputes.resolve_financial'].includes(c) })
    renderWithQueryClient(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Disputes'))
    await screen.findByText(/Order #9/)
    expect(screen.queryByText('🚩 Flag')).not.toBeInTheDocument()
    expect(screen.queryByText('✓ Resolve')).not.toBeInTheDocument()
    expect(screen.queryByText('✕ Reject')).not.toBeInTheDocument()
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
    expect(screen.getByText('AK-039-5040')).toBeInTheDocument()
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
