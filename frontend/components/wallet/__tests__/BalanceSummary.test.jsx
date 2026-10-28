import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../mocks/server.js'
import BalanceSummary from '../BalanceSummary.jsx'

const API = 'http://localhost:8000'
const renderIt = (props) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BalanceSummary {...props} /></QueryClientProvider>,
)
const wallet = (body) => server.use(http.get(`${API}/api/wallet/`, () => HttpResponse.json(body)))

describe('BalanceSummary', () => {
  it('test_customer_balance_two_decimals', async () => {
    wallet({ kind: 'customer', balance: '125.5' })
    renderIt()
    expect(await screen.findByText('GH₵ 125.50')).toBeInTheDocument()
    expect(screen.getByText('AshantiHub wallet')).toBeInTheDocument()
  })

  it('test_vendor_shows_pending_and_available', async () => {
    wallet({ kind: 'vendor', pending: '10.00', available: '4.00' })
    renderIt({ tone: 'dashboard' })
    expect(await screen.findByText('GH₵ 10.00')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 4.00')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.queryByText(/below zero/)).toBeNull()
  })

  it('test_negative_available_explains_the_block', async () => {
    wallet({ kind: 'vendor', pending: '0.00', available: '-3.00' })
    server.use(http.get(`${API}/api/wallet/vendor/`, () => HttpResponse.json({ pending: '0.00', available: '-3.00', withdrawable: '0.00', negative: true, awaiting_call: false, fee_cap: '0.00' })))
    renderIt({ tone: 'dashboard' })
    expect(await screen.findByText('Available is below zero after a late refund; withdrawals wait until it is recovered.')).toBeInTheDocument()
  })

  it('test_held_topup_line_only_when_the_server_sends_it', async () => {
    wallet({ kind: 'customer', balance: '20.00', held_topup_pesewas: 500, topup_free_at: '2026-10-21T08:30:00+00:00' })
    renderIt()
    expect(await screen.findByText(/GH₵ 5\.00 of this was topped up and can be withdrawn from Wed 08:30/)).toBeInTheDocument()
  })

  it('test_no_hold_wording_without_7c_fields', async () => {
    wallet({ kind: 'customer', balance: '20.00', held_topup_pesewas: 0, topup_free_at: null })
    renderIt()
    await screen.findByText('GH₵ 20.00')
    expect(screen.queryByText(/topped up|withdrawn/)).toBeNull()
  })

  it('shows the off text when the ledger is off', async () => {
    server.use(http.get(`${API}/api/wallet/`, () => HttpResponse.json({ code: 'ledger_off' }, { status: 409 })))
    renderIt()
    expect(await screen.findByText("Wallets aren't switched on yet.")).toBeInTheDocument()
  })
})
