import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import * as apiClient from '../../../../apiClient.js'
import CommissionsPanel from '../CommissionsPanel.jsx'
import RefundsPanel from '../RefundsPanel.jsx'
import RevenueSalesPanel from '../RevenueSalesPanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

const revenue = (over = {}) => ({
  from: '2026-10-01', to: '2026-10-07', previous: { from: '2026-09-24', to: '2026-09-30' }, simulated: true,
  kpis: { sales: '200.00', orders: 2, average: '100.00', revenue: '140.00', revenue_share: 70.0, refunded: '20.00', refunds: 1, refund_share: 10.0 },
  types: [
    { key: 'subscriptions', label: 'Subscriptions', note: 'Plan fees paid by businesses', amount: '100.00', previous: '60.00' },
    { key: 'promotions', label: 'Promotions', note: 'Featured and Boost listings', amount: '40.00', previous: '0.00' },
  ],
  months: [{ month: '2026-10', label: 'Oct 2026', days: 7, partial: true, total: '140.00', by_type: { subscriptions: '100.00', promotions: '40.00' } }],
  zones: [{ zone_id: 1, zone: 'Manhyia', sales: '200.00', orders: 2, revenue: '140.00', businesses: 3 }],
  categories: [{ category_id: 1, category: 'Hotels', sales: '200.00', orders: 2, share: 1 }],
  not_recorded: [{ name: 'Commission on sales', why: 'AshantiHub does not take a commission on sales, so none is recorded.' }, { name: 'Delivery fees', why: 'Delivery fees are not charged yet.' }],
  zone_options: [{ id: 1, name: 'Manhyia' }], category_options: [{ id: 1, name: 'Hotels' }],
  ...over,
})

describe('RevenueSalesPanel', () => {
  it('shows recorded sales and revenue, says payments are simulated and lists what is not recorded', async () => {
    server.use(http.get(`${API}/api/insights/revenue/`, () => HttpResponse.json(revenue())))
    wrap(<RevenueSalesPanel />)
    expect(await screen.findByRole('group', { name: 'Sales' })).toHaveTextContent('GH₵ 200.00')
    expect(screen.getByRole('group', { name: 'AshantiHub revenue' })).toHaveTextContent('70% of sales')
    expect(screen.getByRole('note')).toHaveTextContent('Payments are simulated until Hubtel is connected')
    expect(screen.getByRole('heading', { name: 'Revenue by type' })).toBeInTheDocument()
    expect(screen.getByText('Oct 2026')).toBeInTheDocument()
    expect(screen.getByText(/7 days so far/)).toBeInTheDocument()
    // No row is drawn for a source that does not exist.
    expect(screen.queryByRole('cell', { name: /Commission on sales/ })).not.toBeInTheDocument()
    const notRecorded = screen.getByRole('region', { name: 'Not recorded' })
    expect(within(notRecorded).getByText('Commission on sales')).toBeInTheDocument()
    expect(within(notRecorded).getByText('Delivery fees')).toBeInTheDocument()
  })

  it('hides the simulated banner once payments are real and never invents a share without sales', async () => {
    server.use(http.get(`${API}/api/insights/revenue/`, () => HttpResponse.json(revenue({ simulated: false, kpis: { sales: '0.00', orders: 0, average: null, revenue: '0.00', revenue_share: null, refunded: '0.00', refunds: 0, refund_share: null } }))))
    wrap(<RevenueSalesPanel />)
    expect(await screen.findByRole('group', { name: 'Sales' })).toBeInTheDocument()
    expect(screen.queryByText(/Payments are simulated/)).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'AshantiHub revenue' })).toHaveTextContent('No sales in this period')
  })

  it('exports through the same address with the chosen filters and a format', async () => {
    server.use(http.get(`${API}/api/insights/revenue/`, () => HttpResponse.json(revenue())))
    const spy = vi.spyOn(apiClient, 'apiDownload').mockResolvedValue(null)
    wrap(<RevenueSalesPanel />)
    await screen.findByRole('group', { name: 'Sales' })
    fireEvent.change(screen.getByLabelText('Zone'), { target: { value: '1' } })
    await waitFor(() => expect(screen.getByLabelText('Zone')).toHaveValue('1'))
    fireEvent.click(screen.getByRole('button', { name: 'Excel' }))
    await waitFor(() => expect(spy).toHaveBeenCalled())
    const [path] = spy.mock.calls[0]
    expect(path).toMatch(/^\/api\/insights\/revenue\/\?from=\d{4}-\d{2}-01&to=.*zone=1.*format=xlsx$/)
    spy.mockRestore()
  })
})

describe('RefundsPanel', () => {
  const refunds = () => ({
    from: '2026-10-01', to: '2026-10-07', simulated: true,
    kpis: { refunded: '30.00', count: 1, share_of_sales: 15.0, from_disputes: '30.00', disputes: 1, from_tickets: '0.00', tickets: 0 },
    rows: [{ ref: 'DR-4', source: 'dispute', source_label: 'Dispute', detail: 'Quality Issue', customer: 'Ama Buyer', business: 'Kofi Rooms', raised_by: 'Kofi', decided_by: 'Kofi', at: '2026-10-05T10:00:00Z', amount: '30.00', status: 'refunded' }],
    not_recorded: [{ name: 'Refund requests and approval', why: 'There is no refund request or approval step yet.' }],
  })

  it('lists only recorded refunds read-only and states what is missing, with no approve action', async () => {
    server.use(http.get(`${API}/api/insights/refunds/`, () => HttpResponse.json(refunds())))
    wrap(<RefundsPanel />)
    expect(await screen.findByText('DR-4')).toBeInTheDocument()
    expect(screen.getByText('Ama Buyer')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Refunded' })).toHaveTextContent('GH₵ 30.00')
    expect(screen.getByText('Refund requests and approval')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve|decline|return with note/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/waiting for you/i)).not.toBeInTheDocument()
  })

  it('has an honest empty state', async () => {
    server.use(http.get(`${API}/api/insights/refunds/`, () => HttpResponse.json({ ...refunds(), rows: [], kpis: { ...refunds().kpis, refunded: '0.00', count: 0, share_of_sales: null } })))
    wrap(<RefundsPanel />)
    expect(await screen.findByText('No refunds were recorded in this period.')).toBeInTheDocument()
  })

  it('filters by source through the server', async () => {
    const seen = []
    server.use(http.get(`${API}/api/insights/refunds/`, ({ request }) => { seen.push(new URL(request.url).searchParams.get('source')); return HttpResponse.json(refunds()) }))
    wrap(<RefundsPanel />)
    await screen.findByText('DR-4')
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'ticket' } })
    await waitFor(() => expect(seen).toContain('ticket'))
  })
})

describe('CommissionsPanel', () => {
  const overview = () => ({
    simulated: true,
    totals: { on_hold: { amount: '50.00', count: 1 }, payable: { amount: '0.00', count: 0 }, in_batch: { amount: '0.00', count: 0 }, paid: { amount: '0.00', count: 0 }, reversed: { amount: '50.00', count: 1 } },
    scouts: [{ staff_id: 7, name: 'Kwame Asante', active: true, on_hold: '50.00', payable: '0.00', in_batch: '0.00', paid: '0.00', reversed: '50.00' }],
    policy: { registration: { label: 'Registration', amount: '50.00', since: '2026-05-01' }, three_paid_months_bonus: { label: '3-paid-months bonus', amount: null, since: null } },
    batches: { exist: false, note: 'No payout batches exist yet. They arrive with the Accounting phase.' },
    tax_note: 'Tax on commission waits for an accountant or GRA ruling before the first payout.',
  })
  const lines = { count: 1, next: null, previous: null, results: [{ id: 1, staff: 'Kwame Asante', business: 'Nana’s Chop Bar', kind_label: 'Registration', amount: '50.00', status: 'on_hold', status_label: 'On hold', earned_at: '2026-10-07T10:00:00Z', hold_until: '2027-01-05T10:00:00Z', reversed_label: null, reversed_at: null }] }

  it('shows scouts totals, never invents batches or payouts, and keeps the tax note undecided', async () => {
    server.use(
      http.get(`${API}/api/insights/commissions/`, () => HttpResponse.json(overview())),
      http.get(`${API}/api/commission/accruals/`, () => HttpResponse.json(lines)),
    )
    wrap(<CommissionsPanel />)
    expect(await screen.findByRole('group', { name: 'On hold' })).toHaveTextContent('GH₵ 50.00')
    expect(screen.getByRole('group', { name: 'In a payout batch' })).toHaveTextContent('No payout batches exist yet')
    expect(screen.getByRole('group', { name: 'Paid' })).toHaveTextContent('No payouts recorded yet')
    expect(screen.getByRole('group', { name: '3-paid-months bonus' })).toHaveTextContent('No amount approved')
    expect(screen.getByRole('group', { name: 'Reversed' })).toHaveTextContent('− GH₵ 50.00')
    expect(screen.getByText(/waits for an accountant or GRA ruling/)).toBeInTheDocument()
    expect(screen.getAllByRole('row', { name: /Kwame Asante/ }).length).toBeGreaterThanOrEqual(1)
    expect(await screen.findByText('Nana’s Chop Bar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /review .* batch/i })).not.toBeInTheDocument()
  })

  it('downloads one scout statement through the sudo-protected endpoint', async () => {
    server.use(
      http.get(`${API}/api/insights/commissions/`, () => HttpResponse.json(overview())),
      http.get(`${API}/api/commission/accruals/`, () => HttpResponse.json(lines)),
    )
    const spy = vi.spyOn(apiClient, 'apiDownload').mockResolvedValue(null)
    wrap(<CommissionsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Statement for Kwame Asante' }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/api/insights/commissions/statement/?staff=7&format=pdf', 'commission-statement-Kwame Asante.pdf'))
    spy.mockRestore()
  })

  it('filters accruals by status on the server', async () => {
    const seen = []
    server.use(
      http.get(`${API}/api/insights/commissions/`, () => HttpResponse.json(overview())),
      http.get(`${API}/api/commission/accruals/`, ({ request }) => { seen.push(new URL(request.url).searchParams.get('status')); return HttpResponse.json(lines) }),
    )
    wrap(<CommissionsPanel />)
    await screen.findByText('Nana’s Chop Bar')
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'reversed' } })
    await waitFor(() => expect(seen).toContain('reversed'))
  })
})
