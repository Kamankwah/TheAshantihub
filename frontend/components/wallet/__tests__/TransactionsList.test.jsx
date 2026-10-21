import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../mocks/server.js'
import RefundNotice from '../RefundNotice.jsx'
import TransactionsList from '../TransactionsList.jsx'

const API = 'http://localhost:8000'
const renderIt = (props, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) => render(
  <QueryClientProvider client={client}><TransactionsList {...props} /></QueryClientProvider>,
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

  it('test_failed_load_more_shows_the_error_and_retries_the_same_page', async () => {
    let failing = true
    server.use(http.get(`${API}/api/wallet/transactions/`, ({ request }) => {
      const p = new URL(request.url).searchParams.get('page')
      if (p === '2') {
        return failing
          ? HttpResponse.json({ detail: 'Server trouble.' }, { status: 500 })
          : HttpResponse.json({ count: 3, next: `${API}/api/wallet/transactions/?page=3`, previous: 'x', results: [row({ id: 2, label: 'Top-up two' })] })
      }
      if (p === '3') return HttpResponse.json({ count: 3, next: null, previous: 'x', results: [row({ id: 3, label: 'Top-up three' })] })
      return HttpResponse.json({ count: 3, next: `${API}/api/wallet/transactions/?page=2`, previous: null, results: [row({ id: 1, label: 'Top-up one' })] })
    }))
    renderIt()
    await screen.findByText('Top-up one')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Server trouble.', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.getByText('Top-up one')).toBeInTheDocument()
    failing = false
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Top-up two')).toBeInTheDocument()
    expect(screen.queryByText('Server trouble.')).toBeNull()
    expect(screen.queryByText('Top-up three')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Top-up three')).toBeInTheDocument()
  }, 20000)

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

  it('test_pending_and_available_rows_name_their_account', async () => {
    page([
      row({ id: 1, account: 'pending', kind: 'order_release', label: 'Released to you', direction: 'out', amount: '100.00' }),
      row({ id: 2, account: 'available', kind: 'order_release', label: 'Released to you', direction: 'in', amount: '95.00' }),
      row({ id: 3, account: 'wallet', label: 'Top-up' }),
    ])
    renderIt({ tone: 'dashboard' })
    const out = (await screen.findByText('−GH₵ 100.00')).closest('li')
    expect(within(out).getByText('Pending')).toBeInTheDocument()
    const inn = screen.getByText('+GH₵ 95.00').closest('li')
    expect(within(inn).getByText('Available')).toBeInTheDocument()
    const plain = screen.getByText('Top-up').closest('li')
    expect(within(plain).queryByText('Pending')).toBeNull()
    expect(within(plain).queryByText('Available')).toBeNull()
  })

  it('test_invalidation_after_load_more_starts_over_without_a_repeated_row', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const all = [5, 4, 3, 2, 1].map((n) => row({ id: n, label: `Row ${n}` }))
    const serve = (rows) => server.use(http.get(`${API}/api/wallet/transactions/`, ({ request }) => {
      const p = Number(new URL(request.url).searchParams.get('page') || 1)
      const slice = rows.slice((p - 1) * 2, p * 2)
      const next = p * 2 < rows.length ? `${API}/api/wallet/transactions/?page=${p + 1}` : null
      return HttpResponse.json({ count: rows.length, next, previous: null, results: slice })
    }))
    serve(all.slice(1)) // 4,3,2,1
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderIt({}, client)
    await screen.findByText('Row 4')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Row 2')
    serve(all) // a new row 5 arrives: every later page shifts by one
    await client.invalidateQueries({ queryKey: ['wallet'] })
    expect(await screen.findByText('Row 5')).toBeInTheDocument()
    expect(screen.queryByText('Row 3')).toBeNull()
    expect(screen.getAllByText('Row 4').length).toBe(1)
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    await screen.findByText('Row 2')
    expect(screen.getAllByRole('listitem').map((li) => li.textContent.match(/Row \d/)[0])).toEqual(['Row 5', 'Row 4', 'Row 3', 'Row 2'])
    expect(errors.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false)
    errors.mockRestore()
  })
})
