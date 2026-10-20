import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import UsersPanel from '../UsersPanel.jsx'

// Reading a customer/business-owner detail needs users.view (writes need
// users.manage). A session that can see this panel already held users.view
// when it loaded, so a 403 means its access changed mid-session — shown at
// once (no retries), as a permission note, not as a broken load.
const CUSTOMER = { id: 1, full_name: 'Ama Serwaa', phone: '024 *** 0001', email: 'am•••@example.com', is_suspended: false }

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

  const OWNER = { id: 9, full_name: 'Kwame Trader', login_phone: '020 *** 2233', kyc_status: 'verified', is_suspended: false }
  const BASE_PROFILE = {
    business_contact_phone: '020 *** 0009', business_kind: 'product', gps_address: 'AK-039-5028',
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

  it('shows the phone masked and reveals the full number only through the password-confirmed POST', async () => {
    let revealed = 0
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [CUSTOMER] })),
      http.get('http://localhost:8000/api/accounts/customers/1/', () => HttpResponse.json({ ...CUSTOMER, address: 'Adum', created_at: '2026-01-01T00:00:00Z' })),
      http.post('http://localhost:8000/api/marketplace/customers/1/reveal-phone/', () => { revealed += 1; return HttpResponse.json({ phone: '+233240000001' }) }),
    )
    renderPanel(['users.view'])
    expect(await screen.findByText(/024 \*\*\* 0001/)).toBeInTheDocument()
    fireEvent.click(await screen.findByText('👁️ View'))
    expect(revealed).toBe(0)
    fireEvent.click(await screen.findByRole('button', { name: /Show full phone of Ama Serwaa/ }))
    expect(await screen.findByText('+233240000001')).toBeInTheDocument()
    expect(revealed).toBe(1)
  })

  it('does not write the masked phone back when editing', async () => {
    let patched = null
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [CUSTOMER] })),
      http.get('http://localhost:8000/api/accounts/customers/1/', () => HttpResponse.json({ ...CUSTOMER, address: 'Adum', created_at: '2026-01-01T00:00:00Z' })),
      http.patch('http://localhost:8000/api/accounts/customers/1/', async ({ request }) => { patched = await request.json(); return HttpResponse.json({ ...CUSTOMER }) }),
    )
    renderPanel(['users.view', 'users.manage'])
    fireEvent.click(await screen.findByText('✏️ Edit'))
    fireEvent.click(await screen.findByText('Save changes'))
    await screen.findByText('✏️ Edit')
    expect(patched).not.toBeNull()
    expect(patched).not.toHaveProperty('phone')
  })
})

describe('UsersPanel save: the second-person contract', () => {
  const DETAIL = { ...CUSTOMER, address: 'Adum', created_at: '2026-01-01T00:00:00Z' }
  const open = async (patchHandler) => {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [CUSTOMER] })),
      http.get('http://localhost:8000/api/accounts/customers/1/', () => HttpResponse.json(DETAIL)),
      http.patch('http://localhost:8000/api/accounts/customers/1/', patchHandler),
    )
    renderPanel(['users.view', 'users.manage'])
    fireEvent.click(await screen.findByText('✏️ Edit'))
    await screen.findByText('Save changes')
  }

  it('shows sent-for-approval on a 201 with approval_id', async () => {
    await open(() => HttpResponse.json({ ...CUSTOMER, approval_id: 41, approval_ids: [41], status: 'pending' }, { status: 201 }))
    fireEvent.click(screen.getByText('Save changes'))
    const note = await screen.findByRole('status')
    expect(note).toHaveTextContent('Sent for approval (request #41). The details change when another person approves.')
    expect(note).not.toHaveTextContent('Other changes were saved')
    expect(screen.queryByText('Save changes')).not.toBeInTheDocument()
  })

  it('counts the requests when more than one was sent', async () => {
    await open(() => HttpResponse.json({ ...CUSTOMER, approval_id: 41, approval_ids: [41, 42], status: 'pending' }, { status: 201 }))
    fireEvent.click(screen.getByText('Save changes'))
    expect(await screen.findByRole('status')).toHaveTextContent('Sent for approval (2 requests).')
  })

  it('plain save still says nothing special', async () => {
    await open(() => HttpResponse.json({ ...CUSTOMER }))
    fireEvent.click(screen.getByText('Save changes'))
    await screen.findByText('✏️ Edit')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText(/Sent for approval/)).not.toBeInTheDocument()
  })

  it('no_change shows its own message', async () => {
    await open(() => HttpResponse.json({ detail: 'That is already the current value.', code: 'no_change' }, { status: 400 }))
    fireEvent.click(screen.getByText('Save changes'))
    expect(await screen.findByText('That is already the current value.')).toBeInTheDocument()
    expect(screen.queryByText(/Could not save/)).not.toBeInTheDocument()
  })

  it('mixed PATCH reports the saved part', async () => {
    await open(() => HttpResponse.json({ ...CUSTOMER, address: 'Bantama', approval_id: 7, approval_ids: [7], status: 'pending' }, { status: 201 }))
    fireEvent.change(screen.getByDisplayValue('Adum'), { target: { value: 'Bantama' } })
    fireEvent.click(screen.getByText('Save changes'))
    expect(await screen.findByRole('status')).toHaveTextContent('Sent for approval (request #7). The details change when another person approves. Other changes were saved.')
  })

  it('does not send an unchanged masked email, and does send a really changed one', async () => {
    const bodies = []
    await open(async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({ ...CUSTOMER }) })
    fireEvent.change(screen.getByDisplayValue('Adum'), { target: { value: 'Bantama' } })
    fireEvent.click(screen.getByText('Save changes'))
    await screen.findByText('✏️ Edit')
    expect(bodies[0]).toEqual({ address: 'Bantama' })
    expect(bodies[0]).not.toHaveProperty('email')

    fireEvent.click(screen.getByText('✏️ Edit'))
    await screen.findByText('Save changes')
    fireEvent.change(await screen.findByDisplayValue('am•••@example.com'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1].email).toBe('new@example.com')
  })
})
