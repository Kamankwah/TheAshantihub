import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { BusinessDashboard } from './App.jsx'
import { server } from './mocks/server.js'

function renderWithQueryClient(ui) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function mockDashboardData({ profile } = {}) {
  server.use(
    http.get('http://localhost:8000/api/listings/mine/', () => HttpResponse.json([])),
    http.get('http://localhost:8000/api/accounts/business-owners/me/profile/', () => HttpResponse.json(profile || {
      ghana_card_number: 'GHA-1', gps_address: 'AK-1', business_contact_phone: '+233200000000', is_formal: false,
    })),
    http.get('http://localhost:8000/api/billing/plans/', () => HttpResponse.json([])),
    http.get('http://localhost:8000/api/billing/subscriptions/me/', () => HttpResponse.json({})),
  )
}

function makeAuth(overrides = {}) {
  return {
    submitBusinessInfo: vi.fn().mockResolvedValue({}),
    submitPayoutInfo: vi.fn().mockResolvedValue({}),
    acceptBusinessTerms: vi.fn().mockResolvedValue({}),
    refreshUser: vi.fn().mockResolvedValue({ registration_step: 'complete' }),
    logout: vi.fn(),
    ...overrides,
  }
}

describe('BusinessDashboard approval gating', () => {
  it('shows the normal tabs when verified', async () => {
    mockDashboardData()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', kycStatus: 'verified' }} />)
    await waitFor(() => expect(screen.getByText(/Akwaaba, Abena/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Listings & Prices/ })).not.toBeDisabled()
  })

  it('shows a pending-review status card with disabled tabs when pending', async () => {
    mockDashboardData()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', kycStatus: 'pending' }} />)
    expect(screen.getByText(/under review/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Listings & Prices/ })).toBeDisabled()
    expect(screen.queryByText(/Akwaaba, Abena/)).not.toBeInTheDocument()
  })

  it('shows the rejection reason and a resubmit button when rejected', async () => {
    mockDashboardData()
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', kycStatus: 'rejected', kycRejectionReason: 'Blurry Ghana Card' }} />)
    expect(screen.getByText('Blurry Ghana Card')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fix and Resubmit' })).toBeInTheDocument()
  })

  it('clicking Fix and Resubmit opens the registration flow pre-filled with the existing profile', async () => {
    mockDashboardData({ profile: { ghana_card_number: 'GHA-999', gps_address: 'AK-9', business_contact_phone: '+233209999999', is_formal: false } })
    renderWithQueryClient(<BusinessDashboard onExit={vi.fn()} auth={makeAuth()} user={{ fullName: 'Abena', kycStatus: 'rejected', kycRejectionReason: 'Blurry Ghana Card' }} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fix and Resubmit' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Fix and Resubmit' }))
    await waitFor(() => expect(screen.getByPlaceholderText('Ghana Card number')).toHaveValue('GHA-999'))
  })
})
