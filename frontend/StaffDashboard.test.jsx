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
  })

  it('a super_admin-shaped session sees every nav item', () => {
    const auth = makeAuth({
      user: { token: 't', account_type: 'staff', id: 2, full_name: 'Kwame Super', role: 'super_admin', permissions: [
        'kyc.approve', 'listings.moderate', 'hero_media.approve', 'users.view', 'escrow.view', 'escrow.release',
        'disputes.resolve_financial', 'transactions.report', 'promotions.manage', 'analytics.view',
        'categories.manage', 'messaging.manage', 'disputes.flag', 'staff.manage', 'zones.manage',
      ] },
      hasPermission: () => true,
    })
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    ;['KYC Queue', 'Listings Moderation', 'Hero Approval', 'Users', 'Categories & Zones', 'Staff Management',
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
})
