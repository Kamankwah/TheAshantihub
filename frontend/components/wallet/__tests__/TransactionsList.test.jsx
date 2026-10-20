import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../mocks/server.js'
import RefundNotice from '../RefundNotice.jsx'
import TransactionsList from '../TransactionsList.jsx'

const API = 'http://localhost:8000'
const renderIt = (props) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TransactionsList {...props} /></QueryClientProvider>,
)
const row = (o) => ({
  id: 1, at: '2026-10-18T10:30:00+00:00', account: 'wallet', kind: 'wallet_top_up', label: 'Top-up',
  direction: 'in', amount: '20.00', order: null, booking_sale: null, reference: '', ...o,
})
const page = (results, next = null) => server.use(
  http.get(`${API}/api/wallet/transactions/`, () => HttpResponse.json({ count: results.length, next, previous: null, results })),
)

describe('TransactionsList', () => {
  it('test_in_and_out_rows_carry_a_sign_and_an_arrow_not_just_colour', async () => {
    page([row({ id: 1, amount: '20.00' }), row({ id: 2, kind: 'order_payment', label: 'Order payment', direction: 'out', amount: '7.50' })])
    renderIt()
    const inRow = (await screen.findByText('Top-up')).closest('li')
    expect(within(inRow).getByText('+GH₵ 20.00')).toBeInTheDocument()
    expect(within(inRow).getByText('in')).toBeInTheDocument()
    const outRow = screen.getByText('Order payment').closest('li')
    expect(within(outRow).getByText('−GH₵ 7.50')).toBeInTheDocument()
    expect(within(outRow).getByText('out')).toBeInTheDocument()
  })

  it('test_order_rows_link_through_orderHref', async () => {
    page([row({ kind: 'order_payment', label: 'Order payment', direction: 'out', amount: '5.00', order: 42 })])
    renderIt({ orderHref: (id) => `/orders/${id}` })
    const link = await screen.findByRole('link', { name: /order #42/i })
    expect(link).toHaveAttribute('href', '/orders/42')
  })

  it('test_vendor_rows_without_orderHref_render_no_link', async () => {
    page([row({ kind: 'order_release', label: 'Released to you', amount: '5.00', order: 42 })])
    renderIt({ tone: 'dashboard' })
    expect(await screen.findByText('Released to you')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('test_load_more_follows_next_and_appends', async () => {
    server.use(http.get(`${API}/api/wallet/transactions/`, ({ request }) => {
      const p = new URL(request.url).searchParams.get('page')
      return p === '2'
        ? HttpResponse.json({ count: 2, next: null, previous: 'x', results: [row({ id: 2, label: 'Top-up two' })] })
        : HttpResponse.json({ count: 2, next: `${API}/api/wallet/transactions/?page=2`, previous: null, results: [row({ id: 1, label: 'Top-up one' })] })
    }))
    renderIt()
    expect(await screen.findByText('Top-up one')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Top-up two')).toBeInTheDocument()
    expect(screen.getByText('Top-up one')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('test_empty_state_text', async () => {
    renderIt()
    expect(await screen.findByText("You don't have any transactions yet.")).toBeInTheDocument()
  })

  it('test_ledger_off_state', async () => {
    server.use(http.get(`${API}/api/wallet/transactions/`, () => HttpResponse.json({ detail: 'off', code: 'ledger_off' }, { status: 409 })))
    renderIt()
    expect(await screen.findByText("Wallets aren't switched on yet.")).toBeInTheDocument()
  })

  it('test_refund_row_shows_the_notice', async () => {
    page([row({ kind: 'order_refund', label: 'Refund', direction: 'in', amount: '9.00', order: 7 })])
    renderIt()
    expect(await screen.findByText('Refunded to your AshantiHub wallet for order #7')).toBeInTheDocument()
  })

  it('test_refund_notice_has_no_invented_reason', () => {
    const { container } = render(<RefundNotice line={row({ kind: 'booking_refund', direction: 'in', order: null })} />)
    expect(container.textContent).toBe('Refunded to your AshantiHub wallet')
    expect(container.textContent).not.toMatch(/because|reason|fee|charge|within|days|hours/i)
  })

  it('test_withdrawal_returned_row_is_labelled_by_the_server_label', async () => {
    page([row({ kind: 'withdrawal_reversed', label: 'Withdrawal returned', direction: 'in', amount: '30.00' })])
    renderIt({ tone: 'dashboard' })
    expect(await screen.findByText('Withdrawal returned')).toBeInTheDocument()
  })

  it('test_filter_chips_say_they_filter_loaded_rows_only', async () => {
    server.use(http.get(`${API}/api/wallet/transactions/`, () => HttpResponse.json({
      count: 3, next: `${API}/api/wallet/transactions/?page=2`, previous: null,
      results: [row({ id: 1 }), row({ id: 2, kind: 'order_payment', label: 'Order payment', direction: 'out' }), row({ id: 3, kind: 'mystery', label: 'Something new' })],
    })))
    renderIt()
    expect(await screen.findByText('Shows what is loaded')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Top-ups' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Purchases' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refunds' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Purchases' }))
    expect(screen.getByText('Order payment')).toBeInTheDocument()
    expect(screen.queryByText('Top-up')).toBeNull()
    expect(screen.queryByText('Something new')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('Something new')).toBeInTheDocument()
  })

  it('test_filter_note_goes_when_everything_is_loaded', async () => {
    page([row({ id: 1 })])
    renderIt()
    await screen.findByText('Top-up')
    expect(screen.queryByText('Shows what is loaded')).toBeNull()
  })
})
