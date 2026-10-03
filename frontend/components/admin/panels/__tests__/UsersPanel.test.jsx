import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import UsersPanel from '../UsersPanel.jsx'

// Reading a customer/business-owner detail needs users.view (writes need
// users.manage). Any remaining 403 — e.g. a revoked grant the session hasn't
// picked up — must read as a permission limit, shown at once (no retries),
// not as a broken load.
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
    expect(await screen.findByText(/need the users\.view permission/)).toBeInTheDocument()
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
})
