import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import UsersPanel from '../UsersPanel.jsx'

// The customer/business-owner detail endpoint is gated on users.manage, but a
// users.view-only session (support, scout) still gets the 👁️ View button (a
// StaffDashboard.test.jsx contract). Its 403 must read as a permission limit,
// not a broken load.
const CUSTOMER = { id: 1, full_name: 'Ama Serwaa', phone: '+233240000001', email: 'ama@example.com', is_suspended: false }

function renderPanel(perms) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const auth = { hasPermission: (c) => perms.includes(c) }
  return render(<QueryClientProvider client={queryClient}><UsersPanel auth={auth} /></QueryClientProvider>)
}

describe('UsersPanel detail view', () => {
  it('explains a 403 on the detail endpoint as a missing users.manage permission', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [CUSTOMER] })),
      http.get('http://localhost:8000/api/accounts/customers/1/', () => HttpResponse.json({ detail: 'forbidden' }, { status: 403 })),
    )
    renderPanel(['users.view'])
    fireEvent.click(await screen.findByText('👁️ View'))
    expect(await screen.findByText(/need the users\.manage permission/)).toBeInTheDocument()
    expect(screen.queryByText("Could not load this account's details.")).not.toBeInTheDocument()
  })

  it('keeps the generic message for other failures', async () => {
    server.use(
      http.get('http://localhost:8000/api/accounts/customers/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [CUSTOMER] })),
      http.get('http://localhost:8000/api/accounts/customers/1/', () => HttpResponse.json({}, { status: 500 })),
    )
    renderPanel(['users.view', 'users.manage'])
    fireEvent.click(await screen.findByText('👁️ View'))
    expect(await screen.findByText("Could not load this account's details.")).toBeInTheDocument()
  })
})
