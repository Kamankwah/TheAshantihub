import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setStoredAuth } from '../../../../apiClient.js'
import { server } from '../../../../mocks/server.js'
import AdminCommandCenter from '../../AdminCommandCenter.jsx'

// The Accountant's shell (Accounting canvas): the Money desk at the overview and every canvas
// item opening a screen that is either real or an honest "arrives with the Accounting phase" panel.
const API = 'http://localhost:8000'
const PERMS = ['transactions.report', 'commission.view_all', 'commission.policy', 'escrow.view', 'escrow.release', 'escrow.refund', 'disputes.resolve_financial', 'event_pricing.manage', 'subscription_plans.manage', 'credit.manage']
const auth = { user: { token: 't', account_type: 'staff', id: 4, full_name: 'Kwabena Ofori', role: 'accountant', permissions: PERMS }, hasPermission: (c) => PERMS.includes(c) }
const overview = {
  now: '2026-10-13T09:00:00Z', simulated: true,
  tickets: { held: '180.00', held_count: 3, released: '0.00', released_count: 0, released_this_month: '0.00', refunded: '0.00', refunded_count: 0 },
  commission: { on_hold: { amount: '50.00', count: 2 }, payable: { amount: '25.00', count: 1 } },
  revenue: { from: '2026-10-01', to: '2026-10-13', total: '140.00', types: [{ key: 'subscriptions', label: 'Subscriptions', amount: '140.00' }] },
  refunds: { amount: '0.00', count: 0 }, disputes_waiting: 0, approvals_waiting: 0, chain: { checked: false },
  not_recorded: [{ name: 'Taxes due', why: 'No tax is calculated anywhere yet.' }],
}

function renderShell(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><AdminCommandCenter auth={auth} onExit={vi.fn()} {...props} /></QueryClientProvider>)
}
beforeEach(() => {
  localStorage.clear()
  setStoredAuth({ token: 't', account_type: 'staff', id: 4, full_name: 'Kwabena Ofori' })
  server.use(http.get(`${API}/api/insights/accounting-overview/`, () => HttpResponse.json(overview)))
})
afterEach(() => setStoredAuth(null))

describe("an accountant's shell", () => {
  it('opens on the Money desk, from the overview endpoint only', async () => {
    renderShell()
    expect(await screen.findByRole('heading', { name: 'Money desk' })).toBeInTheDocument()
    expect(await screen.findByRole('group', { name: 'Ticket money held' })).toHaveTextContent('GH₵ 180.00')
    expect(screen.getByRole('banner')).toHaveTextContent('Overview')
  })

  it('lists the nine canvas groups in the sidebar', async () => {
    renderShell()
    const nav = await screen.findByRole('navigation', { name: 'Staff panels' })
    for (const label of ['Decisions', 'Ledger', 'Money in', 'Money out', 'People', 'Tax', 'Controls', 'Plans & pricing', 'Reports']) expect(within(nav).getByText(label)).toBeInTheDocument()
  })

  it.each([
    ['acct-journal', 'Journal'], ['acct-chart', 'Chart of accounts'], ['acct-payroll', 'Payroll'], ['acct-paye', 'PAYE'], ['acct-period-close', 'Period close'],
  ])('opens %s as a shell that says what is missing', async (tab, title) => {
    renderShell({ activeTab: tab, onTabChange: vi.fn() })
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.getByText(/Arrives with the Accounting phase/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Not available yet' })).toBeInTheDocument()
  })

  it('sends a tile to its screen', async () => {
    const onTabChange = vi.fn()
    renderShell({ activeTab: 'overview', onTabChange })
    fireEvent.click(await screen.findByRole('button', { name: /Ticket money held/ }))
    expect(onTabChange).toHaveBeenCalledWith('escrow')
  })

  it('turns an Accounting URL away from other roles', async () => {
    const other = { user: { ...auth.user, role: 'marketing', permissions: [] }, hasPermission: () => false }
    const onTabChange = vi.fn()
    renderShell({ auth: other, activeTab: 'acct-journal', onTabChange })
    await waitFor(() => expect(onTabChange).toHaveBeenCalledWith('overview', { replace: true }))
  })
})
