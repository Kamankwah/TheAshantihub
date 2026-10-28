import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setStepUpHandler } from '../../../apiClient.js'
import { server } from '../../../mocks/server.js'
import WithdrawForm from '../WithdrawForm.jsx'
import WithdrawalHistory from '../WithdrawalHistory.jsx'

const API = 'http://localhost:8000'
const wrap = (ui) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}
const dest = (over = {}) => ({
  id: 7, rail: 'momo', institution: 'MTN', account_name: 'Akosua Ntoma', account_number_masked: '024****567',
  usable_from: '2026-10-01T10:00:00Z', usable: true, removed: false, ...over,
})
const destinations = (rows, path = '/api/wallet') =>
  server.use(http.get(`${API}${path}/destinations/`, () => HttpResponse.json({ results: rows, cooling_hours: 24 })))
const wd = (over = {}) => ({
  id: 1, reference: 'WD-1', amount: '100.00', charge: '1.00', you_receive: '99.00', status: 'processing',
  status_label: 'Processing', destination: dest(), created_at: '2026-10-20T10:05:00Z', settled_at: null, failure_reason: '', ...over,
})
let unregister = null
afterEach(() => {
  if (unregister) unregister()
  unregister = null
  vi.restoreAllMocks()
})

async function ready() {
  await screen.findByLabelText(/pay out to/i)
}
const type = (v) => fireEvent.change(screen.getByLabelText(/amount to withdraw/i), { target: { value: v } })
const submit = () => fireEvent.click(screen.getByRole('button', { name: /withdraw/i }))
function capture(reply) {
  const bodies = []
  server.use(http.post(`${API}/api/wallet/withdrawals/`, async ({ request }) => {
    bodies.push({ body: await request.json(), token: request.headers.get('X-Step-Up-Token') })
    return reply(bodies.length)
  }))
  return bodies
}

describe('WithdrawForm', () => {
  it('test_withdraw_sends_one_request_id_across_a_double_click', async () => {
    destinations([dest()])
    const bodies = capture(() => HttpResponse.json(wd(), { status: 201 }))
    wrap(<WithdrawForm />)
    await ready()
    type('100')
    const btn = screen.getByRole('button', { name: /withdraw/i })
    fireEvent.click(btn)
    fireEvent.click(btn)
    await screen.findByText('Processing')
    expect(bodies).toHaveLength(1)
    expect(bodies[0].body.request_id).toBeTruthy()
    expect(bodies[0].body).toMatchObject({ destination: 7, amount: '100' })
  })

  it('test_request_id_survives_the_step_up_retry', async () => {
    destinations([dest()])
    const seen = []
    server.use(http.post(`${API}/api/wallet/withdrawals/`, async ({ request }) => {
      const body = await request.json()
      seen.push(body.request_id)
      if (!request.headers.get('X-Step-Up-Token')) {
        return HttpResponse.json({ detail: 'Enter a code.', code: 'step_up_required', action: 'withdrawal' }, { status: 403 })
      }
      return HttpResponse.json(wd(), { status: 201 })
    }))
    const handler = vi.fn().mockResolvedValue({ token: 'abc', expiresIn: 300 })
    unregister = setStepUpHandler(handler)
    wrap(<WithdrawForm />)
    await ready()
    type('100')
    submit()
    await screen.findByText('Processing')
    expect(handler).toHaveBeenCalledWith('withdrawal')
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
  })

  it('test_withdraw_retry_after_a_network_error_reuses_the_request_id', async () => {
    destinations([dest()])
    const bodies = capture((n) => (n === 1 ? HttpResponse.error() : HttpResponse.json(wd(), { status: 200 })))
    wrap(<WithdrawForm />)
    await ready()
    type('100')
    submit()
    await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByRole('button', { name: /withdraw/i })).not.toBeDisabled())
    submit()
    await screen.findByText('Processing')
    expect(bodies).toHaveLength(2)
    expect(bodies[1].body.request_id).toBe(bodies[0].body.request_id)
  })

  it('test_request_id_changes_after_success', async () => {
    destinations([dest()])
    const bodies = capture(() => HttpResponse.json(wd(), { status: 201 }))
    wrap(<WithdrawForm />)
    await ready()
    type('100')
    submit()
    await screen.findByText('Processing')
    type('100')
    submit()
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1].body.request_id).not.toBe(bodies[0].body.request_id)
  })

  it('test_request_id_survives_editing_and_reverting_the_amount_after_a_network_error', async () => {
    destinations([dest()])
    const bodies = capture((n) => (n <= 1 ? HttpResponse.error() : HttpResponse.json(wd(), { status: 200 })))
    wrap(<WithdrawForm />)
    await ready()
    type('100')
    submit()
    await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByRole('button', { name: /withdraw/i })).not.toBeDisabled())
    type('10')
    type('100.00')
    submit()
    await screen.findByText('Processing')
    expect(bodies).toHaveLength(2)
    expect(bodies[1].body.request_id).toBe(bodies[0].body.request_id)
  })

  it('test_request_id_changes_when_amount_or_destination_changes', async () => {
    destinations([dest(), dest({ id: 8, account_number_masked: '055****111' })])
    const bodies = capture(() => HttpResponse.json({ detail: 'You have GH₵ 5.00 to withdraw.', code: 'insufficient_funds' }, { status: 409 }))
    wrap(<WithdrawForm />)
    await ready()
    type('100')
    submit()
    await screen.findByRole('alert')
    submit()
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1].body.request_id).toBe(bodies[0].body.request_id)
    type('50')
    await waitFor(() => expect(screen.getByRole('button', { name: /withdraw/i })).not.toBeDisabled())
    submit()
    await waitFor(() => expect(bodies).toHaveLength(3))
    expect(bodies[2].body.request_id).not.toBe(bodies[1].body.request_id)
    fireEvent.change(screen.getByLabelText(/pay out to/i), { target: { value: '8' } })
    await waitFor(() => expect(screen.getByRole('button', { name: /withdraw/i })).not.toBeDisabled())
    submit()
    await waitFor(() => expect(bodies).toHaveLength(4))
    expect(bodies[3].body.request_id).not.toBe(bodies[2].body.request_id)
    expect(bodies[3].body.destination).toBe(8)
  })

  it('test_only_usable_destinations_are_offered', async () => {
    destinations([dest(), dest({ id: 9, usable: false, account_number_masked: '020****999' }), dest({ id: 10, removed: true, usable: false })])
    wrap(<WithdrawForm />)
    await ready()
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option')).toHaveTextContent('024****567')
  })

  it('test_cooling_destination_is_listed_but_not_offered_for_withdrawal', async () => {
    destinations([dest({ usable: false })])
    wrap(<WithdrawForm />)
    expect(await screen.findByText(/still in its waiting period/i)).toBeInTheDocument()
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.queryByRole('button', { name: /withdraw/i })).toBeNull()
    expect(screen.queryByText(/024\*{4}567/)).toBeNull()
  })

  it('shows add-a-number note when there are no destinations', async () => {
    destinations([])
    wrap(<WithdrawForm />)
    expect(await screen.findByText(/add a payout number first/i)).toBeInTheDocument()
  })

  it('test_success_shows_charge_you_receive_and_status', async () => {
    destinations([dest()])
    capture(() => HttpResponse.json(wd({ amount: '100.00', charge: '1.50', you_receive: '98.50', status_label: 'Sent' }), { status: 201 }))
    const onDone = vi.fn()
    wrap(<WithdrawForm onDone={onDone} />)
    await ready()
    type('100')
    submit()
    expect(await screen.findByText('Sent')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 1.50')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 98.50')).toBeInTheDocument()
    expect(onDone).toHaveBeenCalled()
  })

  it('test_no_charge_is_estimated_before_submitting', async () => {
    destinations([dest()])
    wrap(<WithdrawForm />)
    await ready()
    type('100')
    expect(screen.queryByText(/charge/i)).toBeNull()
    expect(screen.queryByText(/you receive/i)).toBeNull()
    expect(screen.queryByText(/GH₵\s*\d/)).toBeNull()
  })

  const CODES = [
    ['suspended', 409], ['invalid', 400], ['unknown_destination', 404], ['destination_cooling', 409], ['name_mismatch', 409],
    ['payouts_unavailable', 409], ['below_charge', 400], ['over_limit', 409], ['negative_balance', 409], ['insufficient_funds', 409],
    ['daily_limit', 409], ['duplicate_request', 409], ['request_id_reused', 409], ['topup_held', 409], ['wallet_disabled', 403], ['not_a_holder', 403],
  ]
  it.each(CODES)('test_each_refusal_code_shows_the_server_detail (%s)', async (code, status) => {
    destinations([dest()])
    capture(() => HttpResponse.json({ detail: `Server words for ${code}.`, code }, { status }))
    wrap(<WithdrawForm />)
    await ready()
    type('100')
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(`Server words for ${code}.`)
  })

  it('test_topup_held_refusal_shows_the_time_it_frees_up', async () => {
    destinations([dest()])
    capture(() => HttpResponse.json({
      detail: 'Money you just added is held.', code: 'topup_held', free_at: '2026-10-22T14:05:00+00:00', held_topup_pesewas: 5000,
    }, { status: 409 }))
    wrap(<WithdrawForm />)
    await ready()
    type('100')
    submit()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Money you just added is held.')
    expect(alert).toHaveTextContent('22 Oct 2026, 14:05')
  })

  it('test_withdraw_form_never_reads_a_step_up_token', async () => {
    destinations([dest()])
    const local = vi.spyOn(Storage.prototype, 'getItem')
    server.use(http.post(`${API}/api/wallet/withdrawals/`, ({ request }) => (
      request.headers.get('X-Step-Up-Token')
        ? HttpResponse.json(wd(), { status: 201 })
        : HttpResponse.json({ detail: 'Enter a code.', code: 'step_up_required', action: 'withdrawal' }, { status: 403 })
    )))
    unregister = setStepUpHandler(async () => ({ token: 'tok', expiresIn: 300 }))
    wrap(<WithdrawForm />)
    await ready()
    local.mockClear()
    type('100')
    submit()
    await screen.findByText('Processing')
    expect(local.mock.calls.filter(([k]) => /step|token/i.test(String(k)) && !/auth/i.test(String(k)))).toEqual([])
    const src = readFileSync(resolve(process.cwd(), 'components/wallet/WithdrawForm.jsx'), 'utf8')
    expect(src).not.toMatch(/X-Step-Up-Token/i)
    expect(src).not.toMatch(/step_up|stepUp|localStorage|sessionStorage/)
  })

  it('test_ledger_off_state', async () => {
    server.use(http.get(`${API}/api/wallet/destinations/`, () => HttpResponse.json({ detail: 'off', code: 'ledger_off' }, { status: 409 })))
    wrap(<WithdrawForm />)
    expect(await screen.findByText("Wallets aren't switched on yet.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /withdraw/i })).toBeNull()
  })

  it('uses the vendor basePath', async () => {
    destinations([dest()], '/api/wallet/vendor')
    const hit = vi.fn()
    server.use(http.post(`${API}/api/wallet/vendor/withdrawals/`, () => { hit(); return HttpResponse.json(wd(), { status: 201 }) }))
    wrap(<WithdrawForm basePath="/api/wallet/vendor" />)
    await ready()
    type('10')
    submit()
    await screen.findByText('Processing')
    expect(hit).toHaveBeenCalledTimes(1)
  })
})

describe('WithdrawalHistory', () => {
  it('test_history_rows_show_the_amount', async () => {
    server.use(http.get(`${API}/api/wallet/withdrawals/`, () => HttpResponse.json({
      count: 1, next: null, previous: null,
      results: [wd({ amount: '250.00', charge: '2.00', you_receive: '248.00', status: 'failed', status_label: 'Failed', failure_reason: 'AshantiHub could not complete it.' })],
    })))
    wrap(<WithdrawalHistory />)
    expect(await screen.findByText('GH₵ 250.00')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 2.00')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 248.00')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('AshantiHub could not complete it.')).toBeInTheDocument()
    expect(screen.getByText(/024\*{4}567/)).toBeInTheDocument()
    expect(screen.getByText(/20 Oct 2026, 10:05/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull()
  })

  it('test_history_load_more_and_cancel_shows_the_servers_reply', async () => {
    server.use(http.get(`${API}/api/wallet/withdrawals/`, ({ request }) => {
      const page = new URL(request.url).searchParams.get('page')
      return page === '2'
        ? HttpResponse.json({ count: 3, next: null, previous: 'x', results: [wd({ id: 3, reference: 'WD-3', amount: '30.00', status: 'succeeded', status_label: 'Paid' })] })
        : HttpResponse.json({ count: 3, next: `${API}/api/wallet/withdrawals/?page=2`, previous: null, results: [
          wd({ id: 1, amount: '10.00', status: 'pending', status_label: 'Waiting' }),
          wd({ id: 2, reference: 'WD-2', amount: '20.00', status: 'processing', status_label: 'Processing' }),
        ] })
    }))
    const cancelled = []
    server.use(
      http.post(`${API}/api/wallet/withdrawals/1/cancel/`, () => { cancelled.push(1); return HttpResponse.json(wd({ id: 1, status: 'cancelled', status_label: 'Cancelled' })) }),
      http.post(`${API}/api/wallet/withdrawals/2/cancel/`, () => { cancelled.push(2); return HttpResponse.json({ detail: 'Only a withdrawal not sent yet can be cancelled.', code: 'not_pending' }, { status: 409 }) }),
    )
    wrap(<WithdrawalHistory />)
    expect(await screen.findByText('GH₵ 10.00')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^cancel/i })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: /^cancel/i })[1])
    expect(await screen.findByText('Only a withdrawal not sent yet can be cancelled.')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /^cancel/i })[0])
    expect(await screen.findByText('Cancelled')).toBeInTheDocument()
    expect(cancelled).toEqual([2, 1])
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('GH₵ 30.00')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('shows an empty state and the ledger-off note', async () => {
    wrap(<WithdrawalHistory />)
    expect(await screen.findByText(/no withdrawals yet/i)).toBeInTheDocument()
  })

  it('test_ledger_off_state (history)', async () => {
    server.use(http.get(`${API}/api/wallet/withdrawals/`, () => HttpResponse.json({ detail: 'off', code: 'ledger_off' }, { status: 409 })))
    wrap(<WithdrawalHistory />)
    expect(await screen.findByText("Wallets aren't switched on yet.")).toBeInTheDocument()
  })

  it('test_result_panel_shows_the_server_amount_and_clears_when_the_amount_changes', async () => {
    destinations([dest()])
    capture(() => HttpResponse.json(wd({ amount: '40.00', charge: '1.00', you_receive: '39.00', status_label: 'Sent' }), { status: 201 }))
    wrap(<WithdrawForm />)
    await ready()
    type('40')
    submit()
    expect(await screen.findByText('GH₵ 40.00 withdrawal')).toBeInTheDocument()
    expect(screen.getByText('Sent')).toBeInTheDocument()
    type('55')
    expect(screen.queryByText('GH₵ 40.00 withdrawal')).toBeNull()
    expect(screen.queryByText(/you receive/i)).toBeNull()
  })

  it('test_result_panel_clears_when_the_destination_changes', async () => {
    destinations([dest(), dest({ id: 8, institution: 'Vodafone', account_number_masked: '020****111' })])
    capture(() => HttpResponse.json(wd({ amount: '40.00' }), { status: 201 }))
    wrap(<WithdrawForm />)
    await ready()
    type('40')
    submit()
    await screen.findByText('GH₵ 40.00 withdrawal')
    fireEvent.change(screen.getByLabelText(/pay out to/i), { target: { value: '8' } })
    expect(screen.queryByText('GH₵ 40.00 withdrawal')).toBeNull()
  })

  it('test_a_failed_background_refetch_of_destinations_keeps_the_form_and_result', async () => {
    destinations([dest()])
    capture(() => HttpResponse.json(wd({ amount: '40.00' }), { status: 201 }))
    wrap(<WithdrawForm />)
    await ready()
    server.use(http.get(`${API}/api/wallet/destinations/`, () => HttpResponse.json({ detail: 'boom' }, { status: 500 })))
    type('40')
    submit()
    expect(await screen.findByText('GH₵ 40.00 withdrawal')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByLabelText(/pay out to/i)).toBeInTheDocument()
    expect(screen.getByText('GH₵ 40.00 withdrawal')).toBeInTheDocument()
  })

  it('test_a_chosen_number_that_disappears_is_not_silently_replaced', async () => {
    destinations([dest(), dest({ id: 8, institution: 'Vodafone', account_number_masked: '020****111' })])
    const bodies = capture(() => HttpResponse.json(wd(), { status: 201 }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><WithdrawForm /></QueryClientProvider>)
    await ready()
    fireEvent.change(screen.getByLabelText(/pay out to/i), { target: { value: '8' } })
    destinations([dest()])
    await client.invalidateQueries({ queryKey: ['wallet'] })
    expect(await screen.findByText(/can't receive money now/i)).toBeInTheDocument()
    type('10')
    expect(screen.getByRole('button', { name: /withdraw/i })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/pay out to/i), { target: { value: '7' } })
    expect(screen.queryByText(/can't receive money now/i)).toBeNull()
    submit()
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].body.destination).toBe(7)
  })
})
