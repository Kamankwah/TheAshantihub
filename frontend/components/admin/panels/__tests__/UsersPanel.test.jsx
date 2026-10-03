import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import UsersPanel from '../UsersPanel.jsx'

// Reading a customer/business-owner detail needs users.view (writes need
// users.manage). A session that can see this panel already held users.view
// when it loaded, so a 403 means its access changed mid-session — shown at
// once (no retries), as a permission note, not as a broken load.
const CUSTOMER = { id: 1, full_name: 'Ama Serwaa', phone: '+233240000001', email: 'ama@example.com', is_suspended: false }

function renderPanel(perms, queryDefaults = { retry: false }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: queryDefaults } })
  const auth = { hasPermission: (c) => perms.includes(c) }
  return render(<QueryClientProvider client={queryClient}><UsersPanel auth={auth} /></QueryClientProvider>)
}

describe('UsersPanel detail view', () => {
  it('explains a 403 on the detail endpoint as a permission limit, without retrying', async () => {
    let detailCalls = 0
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [CUSTOMER] })),
      http.get('http://localhost:8000/api/accounts/customers/1/', () => { detailCalls += 1; return HttpResponse.json({ detail: 'forbidden' }, { status: 403 }) }),
    )
    // Library-default retries (3) — the hook's own retry rule must skip them on 403.
    renderPanel(['users.view'], { retry: undefined })
    fireEvent.click(await screen.findByText('👁️ View'))
    expect(await screen.findByText(/Your access to account details has changed/)).toBeInTheDocument()
    expect(detailCalls).toBe(1)
    expect(screen.queryByText("Could not load this account's details.")).not.toBeInTheDocument()
  })

  it('shows a users.view session the account details', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [CUSTOMER] })),
      http.get('http://localhost:8000/api/accounts/customers/1/', () => HttpResponse.json({ ...CUSTOMER, address: 'Adum, Kumasi', created_at: '2026-01-01T00:00:00Z', payments: [] })),
    )
    renderPanel(['users.view'])
    fireEvent.click(await screen.findByText('👁️ View'))
    expect(await screen.findByText('▲ Hide')).toBeInTheDocument()
    expect(screen.queryByText(/permission/)).not.toBeInTheDocument()
    expect(screen.queryByText("Could not load this account's details.")).not.toBeInTheDocument()
  })

  it('keeps the generic message for other failures', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [CUSTOMER] })),
      http.get('http://localhost:8000/api/accounts/customers/1/', () => HttpResponse.json({}, { status: 500 })),
    )
    renderPanel(['users.view', 'users.manage'])
    fireEvent.click(await screen.findByText('👁️ View'))
    // Non-403 failures keep the hook's 3 retries (1s + 2s + 4s backoff).
    expect(await screen.findByText("Could not load this account's details.", {}, { timeout: 12000 })).toBeInTheDocument()
  }, 15000)

  const OWNER = { id: 9, full_name: 'Kwame Trader', login_phone: '+233201112233', kyc_status: 'verified', is_suspended: false }
  const BASE_PROFILE = {
    business_contact_phone: '+233200000009', business_kind: 'product', gps_address: 'AK-039-5028',
    is_formal: true, address_verified: false, address_verified_by_name: null, address_verified_at: null,
  }
  const openOwner = async (profile, perms) => {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
      http.get('http://localhost:8000/api/accounts/business-owners/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [OWNER] })),
      http.get('http://localhost:8000/api/accounts/business-owners/9/', () => HttpResponse.json({ ...OWNER, email: null, created_at: '2026-01-01T00:00:00Z', profile })),
    )
    renderPanel(perms)
    fireEvent.click(await screen.findByText('Business Owners'))
    fireEvent.click(await screen.findByText('👁️ View'))
    await screen.findByText('AK-039-5028')
  }

  it('shows one dim note, not blank fields, when payout and TIN are withheld (users.view only)', async () => {
    await openOwner(BASE_PROFILE, ['users.view'])
    expect(screen.getByText('Payout and tax details need the users.manage permission.')).toBeInTheDocument()
    expect(screen.queryByText('TIN')).not.toBeInTheDocument()
    expect(screen.queryByText('Payout details')).not.toBeInTheDocument()
    expect(screen.queryByText('Default method')).not.toBeInTheDocument()
  })

  it('renders TIN and masked payout as before when present (users.manage)', async () => {
    await openOwner({
      ...BASE_PROFILE, tin: 'C0001234567', default_payout_method: 'momo', payout_verification_status: 'verified',
      payout_bank_name: '', payout_bank_account_name: '', payout_bank_account_number_masked: null,
      payout_momo_network: 'MTN', payout_momo_name: 'Kwame Trader', payout_momo_number_masked: '•••••99888',
    }, ['users.view', 'users.manage'])
    expect(screen.getByText('C0001234567')).toBeInTheDocument()
    expect(screen.getByText('Payout details')).toBeInTheDocument()
    expect(screen.getByText('•••••99888')).toBeInTheDocument()
    expect(screen.queryByText(/need the users\.manage permission/)).not.toBeInTheDocument()
  })
})
