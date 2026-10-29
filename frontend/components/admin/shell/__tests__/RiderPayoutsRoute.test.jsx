import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setStoredAuth } from '../../../../apiClient.js'
import { server } from '../../../../mocks/server.js'
import AdminCommandCenter from '../../AdminCommandCenter.jsx'

const API = 'http://localhost:8000'
const PERMS = ['transactions.report', 'wallets.view']
const auth = { user: { token: 't', account_type: 'staff', id: 4, full_name: 'Kwabena Ofori', role: 'accountant', permissions: PERMS }, hasPermission: (c) => PERMS.includes(c), logout: vi.fn() }
const renderShell = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AdminCommandCenter auth={auth} onExit={vi.fn()} activeTab="acct-rider-payouts" onTabChange={vi.fn()} />
  </QueryClientProvider>,
)
beforeEach(() => { localStorage.clear(); setStoredAuth({ token: 't', account_type: 'staff', id: 4, full_name: 'Kwabena Ofori' }) })
afterEach(() => setStoredAuth(null))

describe("the Accountant's Rider payouts", () => {
  it('shows rider money when the ledger is on', async () => {
    server.use(http.get(`${API}/api/wallet/staff/wallets/`, () => HttpResponse.json({ count: 1, next: null, previous: null, results: [{ holder_id: 7, rider_id: 3, name: 'Kwesi Rider', company_name: 'Swift Co', employment: 'third_party', balance: '12.00', reserve: '3.00' }] })))
    renderShell()
    expect(await screen.findByRole('heading', { name: 'Rider money' })).toBeInTheDocument()
    expect(await screen.findByText('Kwesi Rider')).toBeInTheDocument()
    expect(screen.queryByText(/Arrives with the Accounting phase/)).toBeNull()
  })

  it('and the shell when it is off', async () => {
    server.use(http.get(`${API}/api/wallet/staff/wallets/`, () => HttpResponse.json({ detail: 'off', code: 'ledger_off' }, { status: 409 })))
    renderShell()
    expect(await screen.findByText(/Arrives with the Accounting phase/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rider payouts' })).toBeInTheDocument()
  })
})
