import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AccountHub from '../account/AccountHub.jsx'
import { server } from '../../mocks/server.js'

const API = 'http://localhost:8000'
const tx = (o) => ({ id: 1, at: '2026-10-18T10:30:00+00:00', account: 'wallet', kind: 'wallet_top_up', label: 'Top-up', direction: 'in', amount: '20.00', order: null, booking_sale: null, reference: '', ...o })
const envelope = (results, next = null) => HttpResponse.json({ count: results.length, next, previous: null, results })
const OFF = () => HttpResponse.json({ detail: "Wallets aren't switched on yet.", code: 'ledger_off' }, { status: 409 })

function Loc() { return <div data-testid="loc">{useLocation().pathname}</div> }
function renderAt(path) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AccountHub user={{ fullName: 'Ama', accountType: 'customer', id: 1 }} auth={{}} render={{}} onContactSupport={vi.fn()} />
        <Loc />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
const OV = '/my-account/payments/overview'
const openTopUp = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Top up' }))
  return screen.findByRole('dialog')
}
const type = (v) => fireEvent.change(screen.getByLabelText(/amount to add/i), { target: { value: v } })

afterEach(() => vi.restoreAllMocks())

describe('WalletOverview', () => {
  it('test_shows_the_balance_from_the_server_with_two_decimals', async () => {
    server.use(http.get(`${API}/api/wallet/`, () => HttpResponse.json({ kind: 'customer', balance: '1250.5' })))
    renderAt(OV)
    expect(await screen.findByText('GH₵ 1,250.50')).toBeInTheDocument()
    expect(screen.getByText('AshantiHub wallet')).toBeInTheDocument()
  })

  it('test_ledger_off_shows_the_not_switched_on_state_on_every_wallet_tab', async () => {
    server.use(http.get(`${API}/api/wallet/`, OFF), http.get(`${API}/api/wallet/transactions/`, OFF))
    for (const tab of ['overview', 'wallet', 'transactions', 'settings']) {
      const { unmount } = renderAt(`/my-account/payments/${tab}`)
      expect(await screen.findByText("Wallets aren't switched on yet.")).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Top up' })).not.toBeInTheDocument()
      unmount()
    }
  })

  it('test_top_up_shows_the_processing_line_before_paying', async () => {
    server.use(http.get(`${API}/api/wallet/processing/`, () => HttpResponse.json({ amount: '50.00', payment_processing: '0.75', you_pay: '50.75', provider: 'hubtel' })))
    renderAt(OV)
    await openTopUp()
    type('50')
    expect(await screen.findByText('You pay GH₵ 50.75 (includes GH₵ 0.75 payment processing); GH₵ 50.00 reaches your wallet.')).toBeInTheDocument()
  })

  it('test_top_up_rejects_bad_amounts_without_a_request', async () => {
    const calls = []
    server.use(http.post(`${API}/api/wallet/top-up/`, async ({ request }) => { calls.push(await request.json()); return HttpResponse.json({ mode: 'immediate' }, { status: 201 }) }))
    renderAt(OV)
    const dialog = await openTopUp()
    for (const v of ['', '0', '1.234', 'abc', '-5']) {
      type(v)
      const btn = within(dialog).getByRole('button', { name: 'Top up' })
      expect(btn).toBeDisabled()
      fireEvent.submit(btn.closest('form'))
    }
    await new Promise((r) => setTimeout(r, 30))
    expect(calls).toHaveLength(0)
  })

  it('test_immediate_top_up_refreshes_the_balance', async () => {
    let balance = '10.00'
    server.use(
      http.get(`${API}/api/wallet/`, () => HttpResponse.json({ kind: 'customer', balance })),
      http.post(`${API}/api/wallet/top-up/`, () => { balance = '60.00'; return HttpResponse.json({ mode: 'immediate', kind: 'customer', balance }, { status: 201 }) }),
    )
    renderAt(OV)
    expect(await screen.findByText('GH₵ 10.00')).toBeInTheDocument()
    await openTopUp()
    type('50')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Top up' }))
    expect(await screen.findByText('GH₵ 60.00')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('test_redirect_top_up_navigates_to_checkout_url', async () => {
    server.use(http.post(`${API}/api/wallet/top-up/`, () => HttpResponse.json({ mode: 'redirect', checkout_url: 'https://pay.example/c/1' }, { status: 201 })))
    const loc = { href: 'http://localhost/' }
    vi.spyOn(window, 'location', 'get').mockReturnValue(loc)
    renderAt(OV)
    await openTopUp()
    type('50')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Top up' }))
    await waitFor(() => expect(loc.href).toBe('https://pay.example/c/1'))
  })

  it('test_server_refusal_text_is_shown_verbatim', async () => {
    server.use(http.post(`${API}/api/wallet/top-up/`, () => HttpResponse.json({ detail: 'Top-ups are paused for your account today.' }, { status: 400 })))
    renderAt(OV)
    await openTopUp()
    type('50')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Top up' }))
    expect(await screen.findByText('Top-ups are paused for your account today.')).toBeInTheDocument()
  })

  it('test_no_gift_card_points_or_offer_blocks', async () => {
    renderAt(OV)
    await screen.findByRole('button', { name: 'Top up' })
    expect(document.body.textContent).not.toMatch(/gift card|reward|points|offers|coupon/i)
  })

  it('test_recent_activity_shows_five_rows_and_see_all', async () => {
    server.use(http.get(`${API}/api/wallet/transactions/`, () => envelope(Array.from({ length: 8 }, (_, i) => tx({ id: i + 1, label: `Row ${i + 1}` })))))
    renderAt(OV)
    expect(await screen.findByText('Row 5')).toBeInTheDocument()
    expect(screen.queryByText('Row 6')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'See all' }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/my-account/payments/transactions')
  })

  it('withdraw jumps to the Wallet tab', async () => {
    renderAt(OV)
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }))
    expect(screen.getByTestId('loc')).toHaveTextContent('/my-account/payments/wallet')
  })
})
