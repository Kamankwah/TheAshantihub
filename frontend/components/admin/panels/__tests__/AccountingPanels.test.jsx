import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import * as apiClient from '../../../../apiClient.js'
import AccountingOverviewPanel from '../AccountingOverviewPanel.jsx'
import AccountingShellPanel, { ACCOUNTING_SHELLS } from '../AccountingShellPanel.jsx'
import AuditChainPanel from '../AuditChainPanel.jsx'
import CollectionsPanel from '../CollectionsPanel.jsx'
import EscrowLedgerPanel from '../EscrowLedgerPanel.jsx'
import MoneyAlertsPanel from '../MoneyAlertsPanel.jsx'
import RefundsPanel from '../RefundsPanel.jsx'
import StatementsPanel from '../StatementsPanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

const overview = (over = {}) => ({
  now: '2026-10-13T09:00:00Z', simulated: true,
  tickets: { held: '180.00', held_count: 3, released: '80.00', released_count: 1, released_this_month: '80.00', refunded: '0.00', refunded_count: 0 },
  commission: { on_hold: { amount: '50.00', count: 2 }, payable: { amount: '25.00', count: 1 } },
  revenue: { from: '2026-10-01', to: '2026-10-13', total: '140.00', types: [{ key: 'subscriptions', label: 'Subscriptions', amount: '100.00' }, { key: 'promotions', label: 'Promotions', amount: '40.00' }] },
  refunds: { amount: '20.00', count: 1 }, disputes_waiting: 2, approvals_waiting: 1,
  chain: { checked: true, checked_at: '2026-10-13T01:00:00Z', ok: true, events: 1200 },
  not_recorded: [{ name: 'Taxes due', why: 'No tax is calculated anywhere yet.' }, { name: 'Payroll', why: 'No payroll record exists.' }],
  ...over,
})
const auth = { user: { full_name: 'Kwabena Ofori', role: 'accountant' }, hasPermission: () => true }

describe('Money desk', () => {
  it('shows only recorded figures and lists the rest as not recorded', async () => {
    server.use(http.get(`${API}/api/insights/accounting-overview/`, () => HttpResponse.json(overview())))
    wrap(<AccountingOverviewPanel auth={auth} onNavigate={() => {}} />)
    expect(await screen.findByRole('group', { name: 'Ticket money held' })).toHaveTextContent('GH₵ 180.00')
    expect(screen.getByRole('group', { name: 'Commission on hold' })).toHaveTextContent('GH₵ 25.00 approved to pay')
    expect(screen.getByRole('group', { name: 'Revenue this month' })).toHaveTextContent('GH₵ 140.00')
    expect(screen.getByRole('group', { name: 'Disputes waiting' })).toHaveTextContent('2')
    expect(screen.getByText('Intact')).toBeInTheDocument()
    expect(screen.getByText(/does not exist yet, so it has no chain/)).toBeInTheDocument()
    const nr = screen.getByRole('region', { name: 'Not recorded yet' })
    expect(within(nr).getByText('Taxes due')).toBeInTheDocument()
    // No figure for what has no record.
    for (const label of [/owed to/i, /payroll/i]) expect(screen.queryByRole('group', { name: label })).not.toBeInTheDocument()
  })

  it('says the nightly check has not run rather than guessing', async () => {
    server.use(http.get(`${API}/api/insights/accounting-overview/`, () => HttpResponse.json(overview({ chain: { checked: false } }))))
    wrap(<AccountingOverviewPanel auth={auth} onNavigate={() => {}} />)
    expect(await screen.findByText('Not checked yet')).toBeInTheDocument()
  })

  it('opens the screen a tile belongs to', async () => {
    server.use(http.get(`${API}/api/insights/accounting-overview/`, () => HttpResponse.json(overview())))
    const onNavigate = vi.fn()
    wrap(<AccountingOverviewPanel auth={auth} onNavigate={onNavigate} />)
    fireEvent.click(await screen.findByRole('button', { name: /Ticket money held/ }))
    expect(onNavigate).toHaveBeenCalledWith('escrow')
  })
})

describe('the honest shells', () => {
  const payouts = {
    simulated: true, commission: { on_hold: { amount: '50.00', count: 2 }, payable: { amount: '25.00', count: 1 }, in_batch: { amount: '0.00', count: 0 }, paid: { amount: '0.00', count: 0 } },
    tickets: { held: '180.00', held_count: 3, released: '80.00', released_count: 1, released_this_month: '80.00', refunded: '0.00', refunded_count: 0 },
    payout_blocker: null, not_recorded: [],
  }
  it.each(Object.keys(ACCOUNTING_SHELLS))('%s says it arrives with the Accounting phase and names what it cannot show', async (id) => {
    server.use(
      http.get(`${API}/api/payouts-overview/`, () => HttpResponse.json(payouts)),
      http.get(`${API}/api/commission/tax-ruling/`, () => HttpResponse.json({ current: null, history: [], blocked_message: 'No ruling has been recorded.' })),
    )
    wrap(<AccountingShellPanel id={id} />)
    expect(screen.getByRole('heading', { name: ACCOUNTING_SHELLS[id].title })).toBeInTheDocument()
    expect(screen.getByText(/Arrives with the Accounting phase/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Not available yet' })).toBeInTheDocument()
    // No journal, run, payslip or tax figure, and no action that implies one.
    expect(screen.queryByRole('button', { name: /New journal entry|Prepare a run|Download PDF|Propose a change|Export DT/ })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
  })

  it('shows currency only where a real record fed it (payout runs: commission and ticket money)', async () => {
    server.use(http.get(`${API}/api/payouts-overview/`, () => HttpResponse.json(payouts)))
    wrap(<AccountingShellPanel id="acct-payout-runs" />)
    expect(await screen.findByRole('group', { name: 'On hold' })).toHaveTextContent('GH₵ 50.00')
    expect(screen.getByRole('group', { name: 'In a payout batch' })).toHaveTextContent('None yet')
  })

  it('shows no currency at all on the ledger, payroll and tax shells', () => {
    for (const id of ['acct-journal', 'acct-chart', 'acct-trial-balance', 'acct-payroll', 'acct-paye', 'acct-ssnit', 'acct-period-close', 'acct-rider-payouts']) {
      const { container, unmount } = wrap(<AccountingShellPanel id={id} />)
      expect(container.textContent).not.toMatch(/GH₵\s?\d/)
      unmount()
    }
  })

  it('keeps the tax rows "to confirm" verbatim and calculates nothing', () => {
    wrap(<AccountingShellPanel id="acct-tax-settings" />)
    expect(screen.getByText('Delivery fee')).toBeInTheDocument()
    expect(screen.getAllByText('To confirm').length).toBeGreaterThan(0)
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })
})

describe('Collections', () => {
  const data = (over = {}) => ({
    from: '2026-10-01', to: '2026-10-13', simulated: true, count: 2, page: 1, page_size: 100,
    types: [{ key: 'orders', label: 'Orders' }, { key: 'subscriptions', label: 'Subscriptions' }],
    summary: [{ key: 'orders', label: 'Orders', count: 1, amount: '150.00' }, { key: 'subscriptions', label: 'Subscriptions', count: 1, amount: '100.00' }],
    rows: [
      { id: 1, at: '2026-10-12T10:00:00Z', type: 'orders', type_label: 'Orders', payer: 'Ama Buyer', what: 'Order #1', reference: 'AH-ORDER_CHECKOUT-AAA', provider: 'simulated', provider_reference: 'AH-ORDER_CHECKOUT-AAA', status: 'success', amount: '150.00' },
      { id: 2, at: '2026-10-12T11:00:00Z', type: 'subscriptions', type_label: 'Subscriptions', payer: 'Kofi Rooms', what: 'Subscription', reference: 'AH-SUBSCRIPTION-BBB', provider: 'simulated', provider_reference: '', status: 'pending', amount: '100.00' },
    ],
    not_recorded: [{ name: 'Delivery fees', why: 'Delivery fees are not charged yet.' }, { name: 'VAT, NHIL and GETFund', why: 'No tax is calculated.' }],
    ...over,
  })

  it('lists payments with both references, never a tax split or delivery fee column', async () => {
    server.use(http.get(`${API}/api/insights/collections/`, () => HttpResponse.json(data())))
    wrap(<CollectionsPanel />)
    expect(await screen.findByText('Ama Buyer')).toBeInTheDocument()
    expect(screen.getByText('AH-ORDER_CHECKOUT-AAA')).toBeInTheDocument()
    expect(screen.getByText('AH-ORDER_CHECKOUT-AAA (simulated)')).toBeInTheDocument()
    expect(screen.getByText('None')).toBeInTheDocument() // the pending payment has no provider reference
    expect(screen.getByRole('group', { name: 'Orders' })).toHaveTextContent('GH₵ 150.00')
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['When', 'Type', 'Payer', 'What for', 'Our reference', 'Provider reference', 'Status', 'Amount'])
    expect(within(screen.getByRole('region', { name: 'Not recorded' })).getByText('Delivery fees')).toBeInTheDocument()
  })

  it('sends the chosen type and search to the server and exports with the same filters', async () => {
    const seen = []
    server.use(http.get(`${API}/api/insights/collections/`, ({ request }) => { seen.push(new URL(request.url).searchParams); return HttpResponse.json(data()) }))
    const spy = vi.spyOn(apiClient, 'apiDownload').mockResolvedValue(null)
    wrap(<CollectionsPanel />)
    await screen.findByText('Ama Buyer')
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'orders' } })
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Ama' } })
    await waitFor(() => expect(seen.at(-1).get('kind')).toBe('orders'))
    await waitFor(() => expect(seen.at(-1).get('q')).toBe('Ama'))
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }))
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy.mock.calls[0][0]).toMatch(/kind=orders.*q=Ama.*format=csv$/)
    spy.mockRestore()
  })
})

describe('Escrow', () => {
  const summary = { simulated: true, held: { amount: '180.00', count: 3 }, released: { amount: '80.00', count: 1 }, refunded: { amount: '0.00', count: 0 }, held_after_event: { amount: '80.00', count: 1 }, not_recorded: [{ name: 'Orders and bookings', why: 'Order and booking money is not held in escrow yet.' }] }
  const ticket = { id: 7, code: 'TK7', price: '80.00', escrow_status: 'held', escrow_held_at: '2026-10-01T00:00:00Z', escrow_released_at: null, escrow_override_note: '', delivered_at: null, refunded_at: null, refund_reason: '', event_name: 'Akwasidae', event_date: '2026-10-05T00:00:00Z', ticket_type_name: 'Regular', purchased_by_name: 'Ama Buyer', released_by_staff_name: null, refunded_by_staff_name: null }
  const staff = (...perms) => ({ hasPermission: (c) => perms.includes(c) })

  it('is tickets only, says orders and bookings are not held, and needs a note before any action', async () => {
    server.use(
      http.get(`${API}/api/events/tickets/escrow/summary/`, () => HttpResponse.json(summary)),
      http.get(`${API}/api/events/tickets/escrow/`, () => HttpResponse.json({ count: 1, results: [ticket] })),
    )
    const post = vi.spyOn(apiClient, 'apiPost').mockResolvedValue({})
    wrap(<EscrowLedgerPanel auth={staff('escrow.view', 'escrow.release', 'escrow.refund')} />)
    expect(await screen.findByText(/Akwasidae — Regular/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Needs you' })).toHaveTextContent('1 ticket')
    expect(within(screen.getByRole('region', { name: 'Not held in escrow' })).getByText('Orders and bookings')).toBeInTheDocument()
    const release = screen.getByRole('button', { name: 'Release' })
    expect(release).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Note for ticket TK7'), { target: { value: 'Event ran' } })
    expect(release).toBeEnabled()
    fireEvent.click(release)
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/events/tickets/7/escrow/release/', { note: 'Event ran' }))
    post.mockRestore()
  })

  it('shows Refund only with escrow.refund and sends the reason', async () => {
    server.use(
      http.get(`${API}/api/events/tickets/escrow/summary/`, () => HttpResponse.json(summary)),
      http.get(`${API}/api/events/tickets/escrow/`, () => HttpResponse.json({ count: 1, results: [ticket] })),
    )
    const post = vi.spyOn(apiClient, 'apiPost').mockResolvedValue({})
    const { unmount } = wrap(<EscrowLedgerPanel auth={staff('escrow.view', 'escrow.release')} />)
    await screen.findByText(/Akwasidae — Regular/)
    expect(screen.queryByRole('button', { name: 'Refund' })).not.toBeInTheDocument()
    unmount()
    wrap(<EscrowLedgerPanel auth={staff('escrow.view', 'escrow.refund')} />)
    await screen.findByText(/Akwasidae — Regular/)
    fireEvent.change(screen.getByLabelText('Note for ticket TK7'), { target: { value: 'Event cancelled' } })
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/events/tickets/7/escrow/refund/', { reason: 'Event cancelled' }))
    post.mockRestore()
  })
})

describe('Refunds for the Accountant', () => {
  it('adds a Waiting for you strip that states there is no approval limit yet', async () => {
    server.use(
      http.get(`${API}/api/insights/refunds/`, () => HttpResponse.json({ from: '2026-10-01', to: '2026-10-13', simulated: true, kpis: { refunded: '0.00', count: 0, share_of_sales: null, from_disputes: '0.00', disputes: 0, from_tickets: '0.00', tickets: 0 }, rows: [], not_recorded: [] })),
      http.get(`${API}/api/insights/accounting-overview/`, () => HttpResponse.json(overview())),
    )
    const onNavigate = vi.fn()
    wrap(<RefundsPanel onNavigate={onNavigate} />)
    const strip = await screen.findByRole('region', { name: 'Waiting for you' })
    await waitFor(() => expect(strip).toHaveTextContent('2 disputes are waiting for a decision'))
    expect(strip).toHaveTextContent('no refund request or approval limit yet')
    fireEvent.click(within(strip).getByRole('button', { name: 'Open disputes' }))
    expect(onNavigate).toHaveBeenCalledWith('disputes')
  })

  it('has no such strip for the Super Admin', async () => {
    server.use(http.get(`${API}/api/insights/refunds/`, () => HttpResponse.json({ from: '2026-10-01', to: '2026-10-13', simulated: true, kpis: { refunded: '0.00', count: 0, share_of_sales: null, from_disputes: '0.00', disputes: 0, from_tickets: '0.00', tickets: 0 }, rows: [], not_recorded: [] })))
    wrap(<RefundsPanel />)
    await screen.findByRole('heading', { name: 'All recorded refunds' })
    expect(screen.queryByRole('region', { name: 'Waiting for you' })).not.toBeInTheDocument()
  })
})

describe('Alerts', () => {
  const alerts = () => ({
    now: '2026-10-13T09:00:00Z', open: 1,
    alerts: [
      { key: 'refund_outlier:DR-9', rule: 'refund_outlier', severity: 'review', title: 'DR-9 refunded GH₵ 200.00, about 5 times the average', detail: 'Dispute: order issue.', at: '2026-10-12T00:00:00Z', resolvable: true, resolved: null },
      { key: 'fraud_flag:3', rule: 'fraud_flag', severity: 'info', title: 'Open fraud case on Kofi Rooms', detail: 'Self-dealing', at: '2026-10-11T00:00:00Z', resolvable: false, resolved: null },
    ],
    rules: [
      { key: 'refund_outlier', name: 'A refund much larger than usual', live: true, what: 'x' },
      { key: 'manual_journal', name: 'A manual journal to cash', live: false, what: 'Needs the ledger, which does not exist yet.' },
    ],
  })
  it('lists live and not-available rules apart, and resolving needs a note', async () => {
    server.use(http.get(`${API}/api/insights/money-alerts/`, () => HttpResponse.json(alerts())))
    const post = vi.spyOn(apiClient, 'apiPost').mockResolvedValue({})
    wrap(<MoneyAlertsPanel />)
    expect(await screen.findByText(/DR-9 refunded/)).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Not available yet')).toBeInTheDocument()
    // A fraud case is for information; it is decided under Fraud cases.
    expect(screen.getAllByRole('button', { name: 'Resolve with a note' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Resolve with a note' }))
    const submit = screen.getByRole('button', { name: 'Resolve' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Note for DR-9/), { target: { value: 'Checked with the buyer' } })
    fireEvent.click(submit)
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/insights/money-alerts/', { key: 'refund_outlier:DR-9', note: 'Checked with the buyer' }))
    post.mockRestore()
  })
})

describe('Audit chain and Statements', () => {
  it('shows the stored result and says there is no ledger chain', async () => {
    server.use(http.get(`${API}/api/activity/chain-status/`, () => HttpResponse.json({ checked: true, checked_at: '2026-10-13T01:00:00Z', ok: true, events: 1200, seal_emailed: false })))
    wrap(<AuditChainPanel />)
    expect(await screen.findByRole('group', { name: 'Last result' })).toHaveTextContent('Intact')
    expect(screen.getByText(/no ledger chain to verify/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Verify now/ })).not.toBeInTheDocument()
  })

  it('warns, and says not to repair, when the last check found a break', async () => {
    server.use(http.get(`${API}/api/activity/chain-status/`, () => HttpResponse.json({ checked: true, checked_at: '2026-10-13T01:00:00Z', ok: false, events: 1200, seal_emailed: true })))
    wrap(<AuditChainPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Do not try to repair entries by hand')
  })

  it('shows revenue by type only and states what needs a ledger', async () => {
    server.use(http.get(`${API}/api/insights/revenue/`, () => HttpResponse.json({
      simulated: true, kpis: { revenue: '140.00' },
      types: [{ key: 'subscriptions', label: 'Subscriptions', note: 'Plan fees paid by businesses', amount: '100.00', previous: '60.00' }],
    })))
    wrap(<StatementsPanel />)
    expect(await screen.findByText('Total revenue')).toBeInTheDocument()
    expect(screen.getAllByText('GH₵ 140.00').length).toBe(1)
    expect(within(screen.getByRole('region', { name: 'Not available yet' })).getByText('Balance sheet')).toBeInTheDocument()
    expect(screen.queryByText(/profit of/i)).not.toBeInTheDocument()
  })
})
