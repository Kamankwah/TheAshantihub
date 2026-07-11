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
        'kyc.approve', 'listings.moderate', 'users.view', 'escrow.view', 'escrow.release',
        'disputes.resolve_financial', 'transactions.report', 'promotions.manage', 'analytics.view',
        'categories.manage', 'messaging.manage', 'disputes.flag', 'staff.manage', 'zones.manage',
      ] },
      hasPermission: () => true,
    })
    render(<StaffDashboard auth={auth} onExit={vi.fn()} />)
    ;['KYC Queue', 'Listings Moderation', 'Users', 'Categories & Zones', 'Staff Management',
      'Escrow Ledger', 'Disputes', 'Transactions Report', 'Promotions', 'Analytics', 'Messaging / Tickets']
      .forEach((label) => expect(screen.getByText(label)).toBeInTheDocument())
  })

  it('switches panels on nav click and shows a coming-soon message for unbuilt permissions', () => {
    render(<StaffDashboard auth={makeAuth()} onExit={vi.fn()} />)
    fireEvent.click(screen.getByText('Messaging / Tickets'))
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
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
})
