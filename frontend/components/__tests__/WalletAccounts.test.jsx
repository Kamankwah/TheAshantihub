import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setStepUpHandler } from '../../apiClient.js'
import { server } from '../../mocks/server.js'
import AccountHub from '../account/AccountHub.jsx'

// Tab-level tests for Your Payments > Wallet. The components' internals (request_id rules,
// refusal-code table, step-up retry body, cancel reply) are pinned by components/wallet/__tests__
// (Destinations.test.jsx, Withdrawals.test.jsx); here the tab composes them correctly.
const API = 'http://localhost:8000'
const WALLET = '/my-account/payments/wallet'
const dest = (o = {}) => ({
  id: 7, rail: 'momo', institution: 'MTN', account_name: 'Akosua Ntoma', account_number_masked: '024****567',
  name_check: 'hubtel', usable_from: '2026-10-01T10:00:00Z', usable: true, removed: false, ...o,
})
const wd = (o = {}) => ({
  id: 1, reference: 'WD-1', amount: '100.00', charge: '1.00', you_receive: '99.00', status: 'processing',
  status_label: 'Processing', destination: dest(), created_at: '2026-10-20T10:05:00Z', settled_at: null, failure_reason: '', ...o,
})
const list = (rows) => server.use(http.get(`${API}/api/wallet/destinations/`, () => HttpResponse.json({ results: rows, cooling_hours: 24 })))
const history = (rows) => server.use(http.get(`${API}/api/wallet/withdrawals/`, () => HttpResponse.json({ count: rows.length, next: null, previous: null, results: rows })))
const stepUp = (action) => HttpResponse.json({ detail: 'Enter a code.', code: 'step_up_required', action }, { status: 403 })
function Loc() { return <div data-testid="loc">{useLocation().pathname}</div> }
function renderWallet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[WALLET]}>
        <AccountHub user={{ fullName: 'Ama', accountType: 'customer', id: 1 }} auth={{}} render={{}} onContactSupport={vi.fn()} />
        <Loc />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
let unregister = null
afterEach(() => { if (unregister) unregister(); unregister = null; vi.restoreAllMocks() })

describe('Your Payments > Wallet tab', () => {
  it('test_lists_masked_numbers_only_and_never_a_full_number', async () => {
    list([dest()])
    const { container } = renderWallet()
    expect(await screen.findByText('Mobile money numbers for withdrawals')).toBeInTheDocument()
    expect(screen.getByText('These numbers receive withdrawals. You pay with mobile money at checkout by entering the number each time.')).toBeInTheDocument()
    expect(await screen.findByText('024****567')).toBeInTheDocument()
    expect(screen.getByText('Akosua Ntoma')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\d{10}/)
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull()
    expect(container.textContent).not.toMatch(/default/i)
  })

  it('test_cooling_destination_shows_can_receive_from', async () => {
    list([dest({ usable: false, usable_from: '2026-10-22T14:05:00Z' })])
    renderWallet()
    expect(await screen.findByText('Can receive money from 22 Oct 2026, 14:05')).toBeInTheDocument()
    expect(screen.getByText('A new number can receive money after 24 hours.')).toBeInTheDocument()
  })

  it('test_add_number_goes_through_the_step_up_prompt_and_retries_once_with_the_token', async () => {
    list([])
    const seen = []
    server.use(http.post(`${API}/api/wallet/destinations/`, async ({ request }) => {
      const token = request.headers.get('x-step-up-token')
      seen.push({ token, body: await request.json() })
      return token ? HttpResponse.json(dest({ usable: false, usable_from: '2026-10-22T14:05:00Z' }), { status: 201 }) : stepUp('payout_destination')
    }))
    const handler = vi.fn().mockResolvedValue({ token: 'tok1', expiresIn: 300 })
    unregister = setStepUpHandler(handler)
    renderWallet()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a mobile money number' }))
    expect(screen.queryByRole('option', { name: 'Bank account' })).toBeNull()
    fireEvent.change(screen.getByLabelText(/mobile money number/i), { target: { value: '0241234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add destination' }))
    expect(await screen.findByText('Added. It can receive money from 22 Oct 2026, 14:05')).toBeInTheDocument()
    expect(seen.map((s) => s.token)).toEqual([null, 'tok1'])
    expect(seen[1].body).toEqual(seen[0].body)
    expect(seen[0].body).toEqual({ rail: 'momo', institution: 'MTN', account_number: '0241234567' })
  })

  it('test_add_refusal_text_is_shown', async () => {
    list([])
    server.use(http.post(`${API}/api/wallet/destinations/`, () => HttpResponse.json({ detail: 'That number is not registered in the name on your account.', code: 'name_mismatch' }, { status: 400 })))
    renderWallet()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a mobile money number' }))
    fireEvent.change(screen.getByLabelText(/mobile money number/i), { target: { value: '0241234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add destination' }))
    expect(await screen.findByText('That number is not registered in the name on your account.')).toBeInTheDocument()
  })

  it('test_remove_confirms_then_posts_with_step_up', async () => {
    list([dest()])
    const seen = []
    server.use(http.post(`${API}/api/wallet/destinations/7/remove/`, ({ request }) => {
      const token = request.headers.get('x-step-up-token')
      seen.push(token)
      return token ? HttpResponse.json({}) : stepUp('payout_destination')
    }))
    unregister = setStepUpHandler(vi.fn().mockResolvedValue({ token: 'tok2', expiresIn: 300 }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderWallet()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(seen).toEqual([null, 'tok2']))
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('test_withdraw_form_is_on_the_wallet_tab_and_sends_one_request_id_across_a_double_click', async () => {
    list([dest()])
    const bodies = []
    server.use(http.post(`${API}/api/wallet/withdrawals/`, async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json(wd(), { status: 201 }) }))
    renderWallet()
    const amount = await screen.findByLabelText(/amount to withdraw/i)
    fireEvent.change(amount, { target: { value: '100' } })
    const form = amount.closest('form')
    const btn = within(form).getByRole('button', { name: /withdraw/i })
    fireEvent.click(btn)
    fireEvent.click(btn)
    await waitFor(() => expect(within(form).getByText('Processing')).toBeInTheDocument())
    expect(bodies).toHaveLength(1)
    expect(bodies[0].request_id).toBeTruthy()
  })

  it('test_success_shows_charge_you_receive_and_status_and_no_charge_is_estimated_before', async () => {
    list([dest()])
    server.use(http.post(`${API}/api/wallet/withdrawals/`, () => HttpResponse.json(wd(), { status: 201 })))
    renderWallet()
    const amount = await screen.findByLabelText(/amount to withdraw/i)
    fireEvent.change(amount, { target: { value: '100' } })
    expect(screen.queryByText(/charge/i, { selector: 'span' })).toBeNull()
    const form = amount.closest('form')
    expect(within(form).queryByText(/you receive/i)).toBeNull()
    fireEvent.click(within(form).getByRole('button', { name: /withdraw/i }))
    expect(await within(form).findByText('You receive')).toBeInTheDocument()
    expect(within(form).getByText('GH₵ 99.00')).toBeInTheDocument()
    expect(within(form).getByText('GH₵ 1.00')).toBeInTheDocument()
  })

  it('test_history_lists_rows_and_cancel_shows_the_servers_reply', async () => {
    list([dest()])
    history([wd({ id: 2, status: 'pending', status_label: 'Waiting' })])
    server.use(http.post(`${API}/api/wallet/withdrawals/2/cancel/`, () => HttpResponse.json({ detail: 'Only a withdrawal not sent yet can be cancelled.', code: 'not_pending' }, { status: 409 })))
    renderWallet()
    expect(await screen.findByText('Waiting')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^cancel/i }))
    expect(await screen.findByText('Only a withdrawal not sent yet can be cancelled.')).toBeInTheDocument()
  })

  it('test_ledger_off_state', async () => {
    server.use(http.get(`${API}/api/wallet/`, () => HttpResponse.json({ detail: 'off', code: 'ledger_off' }, { status: 409 })))
    renderWallet()
    expect(await screen.findByText("Wallets aren't switched on yet.")).toBeInTheDocument()
    expect(screen.queryByText('Mobile money numbers for withdrawals')).toBeNull()
  })

  it('test_no_card_fields_exist', async () => {
    list([dest()])
    const { container } = renderWallet()
    await screen.findByText('024****567')
    fireEvent.click(screen.getByRole('button', { name: 'Add a mobile money number' }))
    expect(container.textContent).not.toMatch(/card number|CVV|expiry|bank/i)
    expect(container.querySelector('input[autocomplete^="cc-"]')).toBeNull()
  })
})
