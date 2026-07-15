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
    render(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    expect(screen.getByText(/Akwaaba, Akosua/)).toBeInTheDocument()
    expect(screen.getByText('messaging.manage')).toBeInTheDocument()
  })

  it('only shows nav items the session has permission for', () => {
    render(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
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
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    ;['KYC Queue', 'Listings Moderation', 'Hero Approval', 'Reviews', 'Delivery Management', 'Users', 'Categories & Zones', 'Site Settings', 'Staff Management',
      'Escrow Ledger', 'Disputes', 'Transactions Report', 'Promotions', 'Analytics', 'Messaging / Tickets']
      .forEach((label) => expect(screen.getByText(label)).toBeInTheDocument())
  })

  it('switches panels on nav click and shows a coming-soon message for unbuilt permissions', () => {
    render(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Messaging / Tickets'))
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
  })

  // Promotions went self-serve (business owners purchase Featured/Boost from
  // their own dashboard — docs/BUSINESS_EVENTS_ROADMAP.md Phase 5), so the
  // old ComingSoonPanel placeholder here would now be misleading. Assert the
  // informational panel shows instead, not "coming soon".
  it('shows a self-serve informational panel for Promotions instead of coming-soon', () => {
    const auth = makeAuth({ hasPermission: (c) => c === 'promotions.manage' })
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Promotions'))
    expect(screen.getByText('Promotions are self-serve')).toBeInTheDocument()
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
  })

  it('calls onExit when the exit button is clicked', () => {
    const onExit = vi.fn()
    render(<StaffDashboard auth={makeAuth()} onExit={onExit} />)
    fireEvent.click(screen.getByText('← Exit'))
    expect(onExit).toHaveBeenCalled()
  })

  it('toggles theme when the theme button is clicked', () => {
    render(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    const toggle = screen.getByTitle('Toggle theme')
    expect(toggle.textContent).toBe('🌙')
    fireEvent.click(toggle)
    expect(toggle.textContent).toBe('☀️')
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
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
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
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
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
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
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
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
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
