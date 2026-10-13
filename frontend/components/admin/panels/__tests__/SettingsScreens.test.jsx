import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import CommissionPolicyPanel from '../CommissionPolicyPanel.jsx'
import IntegrationsPanel from '../IntegrationsPanel.jsx'
import { PayoutsPayrollPanel, ReconciliationPanel, TaxTablesPanel } from '../LaterPhasePanels.jsx'
import PlansPricesPanel from '../PlansPricesPanel.jsx'
import SystemHealthPanel from '../SystemHealthPanel.jsx'
import TargetLimitsPanel from '../TargetLimitsPanel.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
const get = (path, body) => server.use(http.get(`${API}${path}`, () => HttpResponse.json(body)))

const line = (amount, count) => ({ amount, count, registrations: count, bonuses: 0 })
const payouts = (over = {}) => ({
  simulated: true,
  commission: { on_hold: line('150.00', 3), payable: line('50.00', 1), in_batch: line('0.00', 0), paid: line('0.00', 0) },
  tickets: { held: '80.00', held_count: 1, released: '120.00', released_count: 1, released_this_month: '120.00', refunded: '50.00', refunded_count: 1 },
  payout_blocker: 'Scouts\' tax status has not been ruled on, so scout commission stays on hold and the first payout batch is blocked.',
  not_recorded: [{ name: 'Payroll runs', why: 'No payroll is prepared or paid in AshantiHub yet.' }],
  ...over,
})
const noRuling = { current: null, history: [], payout_blocked: true, blocked_message: 'Scouts\' tax status has not been ruled on, so scout commission stays on hold and the first payout batch is blocked.', can_record: true, options: [{ value: 'employee', label: 'Employees (PAYE)' }, { value: 'agent', label: 'Independent agents (10% withholding tax)' }] }

describe('Later-phase money screens', () => {
  it('Payouts & payroll shows only real records, names what is not recorded and never draws a run', async () => {
    get('/api/payouts-overview/', payouts())
    wrap(<PayoutsPayrollPanel />)
    expect(await screen.findByRole('group', { name: 'On hold' })).toHaveTextContent('GH₵ 150.00')
    expect(screen.getByRole('group', { name: 'In a payout batch' })).toHaveTextContent('None yet')
    expect(screen.getByRole('group', { name: 'Paid' })).toHaveTextContent('None yet')
    expect(screen.getByRole('group', { name: 'Released to organisers' })).toHaveTextContent('GH₵ 120.00')
    expect(screen.getByRole('alert')).toHaveTextContent('the first payout batch is blocked')
    expect(screen.getByText('Payroll runs')).toBeInTheDocument()
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Arrives with the Accounting phase')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('Payouts & payroll hides the blocker once a ruling exists', async () => {
    get('/api/payouts-overview/', payouts({ payout_blocker: null }))
    wrap(<PayoutsPayrollPanel />)
    await screen.findByRole('group', { name: 'On hold' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Reconciliation says it needs Hubtel and statements and shows no match rate', () => {
    wrap(<ReconciliationPanel />)
    expect(screen.getByRole('status')).toHaveTextContent('Arrives with the Accounting phase')
    expect(screen.getByText('Matched and unmatched lines')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\d+%|\d+ of \d+/)
  })

  it('Tax tables: no tax is calculated, delivery fee is no VAT, everything else is to confirm, no rate appears', async () => {
    get('/api/commission/tax-ruling/', noRuling)
    wrap(<TaxTablesPanel />)
    expect(screen.getByText(/No tax is calculated anywhere in AshantiHub yet/)).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    expect(within(rows.find((r) => r.textContent.startsWith('Delivery fee'))).getByText('No VAT, NHIL or GETFund')).toBeInTheDocument()
    expect(within(rows.find((r) => r.textContent.startsWith('Subscription plans'))).getByText('To confirm')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\d+(\.\d+)?%/)
  })

  it('Tax tables shows the scouts ruling once it is recorded', async () => {
    get('/api/commission/tax-ruling/', { ...noRuling, current: { status: 'agent', status_label: 'Independent agents (10% withholding tax)', ruled_on: '2026-10-01', reference: 'GRA 7', note: '', recorded_by: 'Simon', recorded_at: '2026-10-02T10:00:00Z' }, payout_blocked: false })
    wrap(<TaxTablesPanel />)
    expect(await screen.findByText(/Independent agents \(10% withholding tax\) \(ruling GRA 7\)/)).toBeInTheDocument()
  })
})

describe('IntegrationsPanel', () => {
  it('shows each service honestly, what is missing, and no key', async () => {
    get('/api/integrations/', { items: [
      { key: 'payments', name: 'Payments', status: 'simulated', provider: 'Simulated (Hubtel not connected)', summary: 'Every payment is a simulation.', missing: ['Hubtel client id'], note: 'Keys live in the server environment.' },
      { key: 'sms', name: 'SMS', status: 'not_connected', provider: 'None', summary: 'AshantiHub sends no text messages.', missing: ['An SMS provider'], note: '' },
      { key: 'maps', name: 'Maps', status: 'connected', provider: 'OpenStreetMap tiles (no key)', summary: 'Maps show tiles.', missing: [], note: '' },
    ] })
    wrap(<IntegrationsPanel />)
    const payments = await screen.findByRole('region', { name: 'Payments' })
    expect(payments).toHaveTextContent('Simulated')
    expect(payments).toHaveTextContent('What is missing: Hubtel client id')
    expect(screen.getByRole('region', { name: 'SMS' })).toHaveTextContent('Not connected')
    expect(screen.getByRole('region', { name: 'Maps' })).toHaveTextContent('Connected')
    expect(within(screen.getByRole('region', { name: 'Maps' })).queryByText(/What is missing/)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('SystemHealthPanel', () => {
  it('shows measured checks, job heartbeats, and says a job that never ran has not run', async () => {
    get('/api/system-health/', {
      checked_at: '2026-10-13T10:00:00Z', headline: 'Working, with things to watch: Backups.', overall: 'late', simulated_payments: true,
      checks: [
        { key: 'database', name: 'Database', state: 'ok', value: 'Answered in 3 ms', note: '' },
        { key: 'backups', name: 'Backups', state: 'not_reported', value: 'Not reported to the app', note: 'Check the server.' },
      ],
      jobs: [
        { key: 'approvals-escalate', task: 'approvals.tasks.escalate_due_approvals', every: 'every 5 minutes', state: 'ok', last_started_at: '2026-10-13T09:55:00Z', last_finished_at: '2026-10-13T09:55:01Z', took_ms: 1200, error: '' },
        { key: 'sessions-cleanup', task: 'x', every: 'daily at 03:30', state: 'not_run', last_started_at: null, last_finished_at: null, took_ms: null, error: '' },
        { key: 'reports-purge-exports', task: 'y', every: 'daily at 04:00', state: 'down', last_started_at: '2026-10-13T04:00:00Z', last_finished_at: '2026-10-13T04:00:01Z', took_ms: 10, error: 'ValueError: boom' },
      ],
      not_reported: [{ name: 'Past incidents', why: 'Outages are not logged anywhere the app can read.' }],
    })
    wrap(<SystemHealthPanel />)
    expect(await screen.findByText('Working, with things to watch: Backups.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Database' })).toHaveTextContent('Answered in 3 ms')
    expect(screen.getByRole('region', { name: 'Backups' })).toHaveTextContent('Not reported')
    const never = screen.getByRole('row', { name: /sessions-cleanup/ })
    expect(never).toHaveTextContent('Has not run yet')
    expect(never).toHaveTextContent('Not run yet')
    expect(screen.getByRole('row', { name: /approvals-escalate/ })).toHaveTextContent('1.2 s')
    expect(screen.getByRole('row', { name: /reports-purge-exports/ })).toHaveTextContent('ValueError: boom')
    expect(screen.getByText('Past incidents')).toBeInTheDocument()
  })
})

describe('PlansPricesPanel', () => {
  const plan = { id: 4, name: 'Basic Plus', tier: 'product_plus', kind: 'product', monthly_price: '120.00', max_active_listings: null, hero_days: 2, boost_credits_per_month: 3 }
  const setup = (waitingPlans = [plan], tiers = [{ id: 7, duration_days: 14, live_price: '40.00', pending_price: '55.00', proposed_by_name: 'Kofi Accounts' }, { id: 8, duration_days: 30, live_price: '90.00', pending_price: null }]) => {
    server.use(
      http.get(`${API}/api/billing/plans/pending/`, ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('status') === 'pending' ? waitingPlans : [{ ...plan, id: 1, name: 'Basic', monthly_price: '100.00' }])),
      http.get(`${API}/api/events/pricing-tiers/manage/`, () => HttpResponse.json(tiers)),
      http.get(`${API}/api/promotion-prices/`, () => HttpResponse.json({ set_in_code: true, items: [{ kind: 'featured', label: 'Featured', per_day: '5.00' }, { kind: 'boost', label: 'Boost', per_day: '3.00' }] })),
    )
  }

  it('lists both queues, the live plans, and promotion prices as fixed in code', async () => {
    setup()
    wrap(<PlansPricesPanel />)
    expect(await screen.findByText('Waiting for you · 2')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Basic Plus (Products)' })).toHaveTextContent('GH₵ 120.00 a month')
    expect(screen.getByRole('group', { name: 'Shown for 14 days' })).toHaveTextContent('GH₵ 40.00 → GH₵ 55.00')
    expect(screen.getByRole('group', { name: 'Shown for 14 days' })).toHaveTextContent('Proposed by Kofi Accounts')
    expect(await screen.findByRole('cell', { name: 'GH₵ 100.00' })).toBeInTheDocument()
    expect(screen.getByText('GH₵ 5.00')).toBeInTheDocument()
    expect(screen.getByText(/fixed in the code today/)).toBeInTheDocument()
  })

  it('approves a plan and an event price through the existing endpoints', async () => {
    setup()
    const calls = []
    server.use(
      http.post(`${API}/api/billing/plans/4/approve/`, () => { calls.push('plan'); return HttpResponse.json({}) }),
      http.post(`${API}/api/events/pricing-tiers/7/approve/`, () => { calls.push('tier'); return HttpResponse.json({}) }),
    )
    wrap(<PlansPricesPanel />)
    fireEvent.click(within(await screen.findByRole('group', { name: 'Basic Plus (Products)' })).getByRole('button', { name: 'Approve' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Shown for 14 days' })).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(calls).toEqual(['plan', 'tier']))
  })

  it('returns a plan only with a note and sends it', async () => {
    setup([plan], [])
    let body = null
    server.use(http.post(`${API}/api/billing/plans/4/reject/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}) }))
    wrap(<PlansPricesPanel />)
    const card = await screen.findByRole('group', { name: 'Basic Plus (Products)' })
    fireEvent.click(within(card).getByRole('button', { name: 'Return with note' }))
    expect(within(card).getByRole('button', { name: 'Confirm return' })).toBeDisabled()
    fireEvent.change(within(card).getByLabelText('Note for Basic Plus (Products)'), { target: { value: 'Too high' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm return' }))
    await waitFor(() => expect(body).toEqual({ reason: 'Too high' }))
  })

  it('says so when nothing is waiting', async () => {
    setup([], [{ id: 8, duration_days: 30, live_price: '90.00', pending_price: null }])
    wrap(<PlansPricesPanel />)
    expect(await screen.findByText('No price is waiting for approval.')).toBeInTheDocument()
  })
})

describe('TargetLimitsPanel', () => {
  const plans = {
    metrics: ['registrations', 'visits', 'calls', 'renewals'], today: '2026-10-13',
    limits: [{ metric: 'registrations', min_daily: 1, max_daily: 5 }, { metric: 'visits', min_daily: 2, max_daily: 12 }, { metric: 'calls', min_daily: 0, max_daily: 20 }, { metric: 'renewals', min_daily: 0, max_daily: 6 }],
    staff: [
      { id: 5, full_name: 'Yaw Owusu', role: 'scout', daily: { registrations: 3, visits: 6, calls: 8, renewals: null }, state: 'working', areas: [], pending_cut: { approval_id: 31, requested_at: '2026-10-13T08:00:00Z', metrics: { registrations: 1 } } },
      { id: 6, full_name: 'Ama Lead', role: 'operations', daily: {}, state: 'working', areas: [], pending_cut: null },
    ],
  }

  it('shows the limits, the scouts\' targets, and opens a waiting cut in My approvals', async () => {
    get('/api/targets/plans/', plans)
    const open = vi.fn()
    wrap(<TargetLimitsPanel onOpenApproval={open} />)
    expect(await screen.findByText('Mid-month cuts waiting for you · 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review and decide' }))
    expect(open).toHaveBeenCalledWith(31)
    expect(screen.getByLabelText('Visits highest a day')).toHaveValue('12')
    expect(screen.getByRole('cell', { name: 'Yaw Owusu' })).toBeInTheDocument()
    expect(screen.queryByRole('cell', { name: 'Ama Lead' })).not.toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Not set' })).toBeInTheDocument()
  })

  it('refuses a lowest target above the highest, then saves valid limits', async () => {
    get('/api/targets/plans/', plans)
    let sent = null
    server.use(http.put(`${API}/api/targets/limits/`, async ({ request }) => { sent = await request.json(); return HttpResponse.json([]) }))
    wrap(<TargetLimitsPanel />)
    const high = await screen.findByLabelText('Visits highest a day')
    fireEvent.change(screen.getByLabelText('Visits lowest a day'), { target: { value: '13' } })
    expect(screen.getByRole('alert')).toHaveTextContent("the lowest target can't be above the highest")
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Visits lowest a day'), { target: { value: '3' } })
    fireEvent.change(high, { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save limits' }))
    await waitFor(() => expect(sent).not.toBeNull())
    expect(sent.limits.find((l) => l.metric === 'visits')).toEqual({ metric: 'visits', min_daily: 3, max_daily: 15 })
    expect(await screen.findByText(/Limits saved/)).toBeInTheDocument()
  })
})

describe('Commission policy: scouts\' tax status', () => {
  const policies = { current: { registration: null, three_paid_months_bonus: null }, pending: [{ id: 12, kind: 'registration', amount: '55.00', effective_from: '2026-11-01', maker: 'Kofi', created_at: '2026-10-06T10:00:00Z' }], history: [] }

  it('says commission stays on hold and the first batch is blocked until a ruling is recorded, then records one', async () => {
    get('/api/commission/policies/', policies)
    get('/api/commission/tax-ruling/', noRuling)
    let body = null
    server.use(http.post(`${API}/api/commission/tax-ruling/`, async ({ request }) => { body = await request.json(); return HttpResponse.json({}, { status: 201 }) }))
    wrap(<CommissionPolicyPanel showTaxRuling />)
    expect(await screen.findByRole('alert')).toHaveTextContent('stays on hold and the first payout batch is blocked')
    const submit = screen.getByRole('button', { name: 'Record the ruling' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Scouts are'), { target: { value: 'agent' } })
    fireEvent.change(screen.getByLabelText('Reference'), { target: { value: 'GRA letter 9' } })
    fireEvent.click(submit)
    await waitFor(() => expect(body).toMatchObject({ status: 'agent', reference: 'GRA letter 9' }))
    expect(await screen.findByText(/Recorded\./)).toBeInTheDocument()
  })

  it('offers Review and decide on a waiting proposal only when told how to open it', async () => {
    get('/api/commission/policies/', policies)
    const open = vi.fn()
    wrap(<CommissionPolicyPanel onOpenApproval={open} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review and decide' }))
    expect(open).toHaveBeenCalledWith(12)
  })

  it('shows the recorded ruling in place of the warning', async () => {
    get('/api/commission/policies/', policies)
    get('/api/commission/tax-ruling/', { ...noRuling, current: { status: 'employee', status_label: 'Employees (PAYE)', ruled_on: '2026-10-01', reference: 'Memo 4', note: '', recorded_by: 'Simon', recorded_at: '2026-10-02T10:00:00Z' }, payout_blocked: false, history: [] })
    wrap(<CommissionPolicyPanel showTaxRuling />)
    expect(await screen.findByText('Employees (PAYE)', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.queryByText(/first payout batch is blocked/)).not.toBeInTheDocument()
  })
})
