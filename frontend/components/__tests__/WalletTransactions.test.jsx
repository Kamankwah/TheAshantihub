import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import AccountHub from '../account/AccountHub.jsx'
import { server } from '../../mocks/server.js'

const API = 'http://localhost:8000'
const tx = (o) => ({ id: 1, at: '2026-10-18T10:30:00+00:00', account: 'wallet', kind: 'wallet_top_up', label: 'Top-up', direction: 'in', amount: '20.00', order: null, booking_sale: null, reference: '', ...o })
const page = (results, next = null) => HttpResponse.json({ count: results.length, next, previous: null, results })

function renderTx() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/my-account/payments/transactions']}>
        <AccountHub user={{ fullName: 'Ama', accountType: 'customer', id: 1 }} auth={{}} render={{}} onContactSupport={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('WalletTransactions', () => {
  it('test_in_and_out_rows_carry_a_sign_and_an_arrow_not_just_colour', async () => {
    server.use(http.get(`${API}/api/wallet/transactions/`, () => page([
      tx({ id: 1, label: 'Top-up', direction: 'in', amount: '20.00' }),
      tx({ id: 2, label: 'Order payment', kind: 'order_payment', direction: 'out', amount: '7.50' }),
    ])))
    renderTx()
    const inRow = (await screen.findByText('Top-up')).closest('li')
    expect(inRow).toHaveTextContent('↓')
    expect(inRow).toHaveTextContent('+GH₵ 20.00')
    const outRow = screen.getByText('Order payment').closest('li')
    expect(outRow).toHaveTextContent('↑')
    expect(outRow).toHaveTextContent('−GH₵ 7.50')
  })

  it('test_order_rows_link_to_the_order', async () => {
    server.use(http.get(`${API}/api/wallet/transactions/`, () => page([tx({ id: 2, label: 'Order payment', kind: 'order_payment', direction: 'out', order: 42 })])))
    renderTx()
    const link = await screen.findByRole('link', { name: 'Order #42' })
    expect(link).toHaveAttribute('href', '/my-account/orders')
  })

  it('test_load_more_follows_next_and_appends', async () => {
    server.use(http.get(`${API}/api/wallet/transactions/`, ({ request }) => {
      const p = new URL(request.url).searchParams.get('page')
      return p === '2' ? page([tx({ id: 2, label: 'Second page row' })]) : page([tx({ id: 1, label: 'First page row' })], `${API}/api/wallet/transactions/?page=2`)
    }))
    renderTx()
    await screen.findByText('First page row')
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Second page row')).toBeInTheDocument()
    expect(screen.getByText('First page row')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('test_filter_chips_follow_the_servers_kind_values', async () => {
    server.use(http.get(`${API}/api/wallet/transactions/`, () => page([
      tx({ id: 1, label: 'Top-up' }),
      tx({ id: 2, label: 'Order payment', kind: 'order_payment', direction: 'out' }),
    ])))
    renderTx()
    await screen.findByText('Top-up')
    fireEvent.click(screen.getByRole('button', { name: 'Purchases' }))
    expect(screen.queryByText('Top-up')).not.toBeInTheDocument()
    expect(screen.getByText('Order payment')).toBeInTheDocument()
  })

  it('test_empty_state_text', async () => {
    renderTx()
    expect(await screen.findByText("You don't have any transactions yet.")).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).getByRole('link', { name: 'Continue shopping' })).toHaveAttribute('href', '/')
  })

  it('test_ledger_off_state', async () => {
    server.use(
      http.get(`${API}/api/wallet/`, () => HttpResponse.json({ detail: 'x', code: 'ledger_off' }, { status: 409 })),
      http.get(`${API}/api/wallet/transactions/`, () => HttpResponse.json({ detail: 'x', code: 'ledger_off' }, { status: 409 })),
    )
    renderTx()
    expect(await screen.findByText("Wallets aren't switched on yet.")).toBeInTheDocument()
  })
})
