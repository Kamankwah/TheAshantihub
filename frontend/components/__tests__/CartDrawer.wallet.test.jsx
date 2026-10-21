import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../mocks/server.js'
import CartDrawer from '../CartDrawer.jsx'
import { MoMoPayment } from '../../App.jsx'

const API = 'http://localhost:8000'

function StubPayment({ amount, processing, onSuccess, onClose }) {
  return (
    <div>
      <div>Pay {amount}</div>
      <div data-testid="stub-processing">{processing === undefined ? 'undefined' : processing}</div>
      <button onClick={() => onSuccess('REF123')}>Simulate Pay</button>
      <button onClick={onClose}>Done</button>
    </div>
  )
}

function renderDrawer(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CartDrawer
        onClose={vi.fn()}
        user={{ fullName: 'Ama Boateng', accountType: 'customer' }}
        currency="GHS"
        PaymentComponent={StubPayment}
        {...props}
      />
    </QueryClientProvider>,
  )
}

const CART = {
  id: 1,
  items: [{ id: 10, listing: 5, listing_name: 'Kente Cloth', quantity: 2, unit_price_snapshot: '150.00', line_total: '300.00', added_at: '2026-07-10T00:00:00Z' }],
  total: '300.00',
}
const ORDER = { id: 42, status: 'paid', total_amount: '300.00', placed_at: '2026-07-14T00:00:00Z', delivery_method: 'store_pickup', items: [] }

const cart = () => http.get(`${API}/api/cart/`, () => HttpResponse.json(CART))
const walletOn = (b = '500.00') => http.get(`${API}/api/wallet/`, () => HttpResponse.json({ kind: 'customer', balance: b }))
const walletOff = () => http.get(`${API}/api/wallet/`, () => HttpResponse.json({ detail: "Wallets aren't switched on yet.", code: 'ledger_off' }, { status: 409 }))
const processing = (fee = '4.50', pay = '304.50') => http.get(`${API}/api/wallet/processing/`, () => HttpResponse.json({ amount: '300.00', payment_processing: fee, you_pay: pay, provider: 'simulated' }))

async function toConfirm() {
  await screen.findByText('Kente Cloth')
  fireEvent.click(screen.getByText('Checkout →'))
  await screen.findByText('Confirm your order')
}

describe('CartDrawer wallet checkout', () => {
  it('test_wallet_order_posts_payment_method_wallet_without_opening_the_momo_modal', async () => {
    let body = null
    server.use(cart(), walletOn(), processing(), http.post(`${API}/api/orders/checkout/`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ...ORDER, payment_method: 'wallet', payment_processing: '0.00' }, { status: 201 })
    }))
    renderDrawer()
    await toConfirm()
    fireEvent.click(await screen.findByRole('radio', { name: /AshantiHub wallet/ }))
    fireEvent.click(screen.getByText('Confirm & Pay'))
    expect(await screen.findByText('Order Confirmed!')).toBeInTheDocument()
    expect(body).toEqual({ payment_method: 'wallet', delivery_method: 'store_pickup', delivery_address: '', delivery_phone: '' })
    expect(screen.queryByText('Simulate Pay')).not.toBeInTheDocument()
    expect(screen.queryByText(/Payment processing/)).not.toBeInTheDocument()
  })

  it('test_double_click_posts_once', async () => {
    let posts = 0
    server.use(cart(), walletOn(), processing(), http.post(`${API}/api/orders/checkout/`, async () => {
      posts += 1
      await new Promise((r) => setTimeout(r, 80))
      return HttpResponse.json({ ...ORDER, payment_method: 'wallet' }, { status: 201 })
    }))
    renderDrawer()
    await toConfirm()
    fireEvent.click(await screen.findByRole('radio', { name: /AshantiHub wallet/ }))
    const pay = screen.getByText('Confirm & Pay')
    fireEvent.click(pay)
    fireEvent.click(pay)
    await screen.findByText('Order Confirmed!')
    expect(posts).toBe(1)
  })

  it('test_insufficient_funds_shows_the_server_detail_and_keeps_the_cart', async () => {
    server.use(cart(), walletOn(), processing(), http.post(`${API}/api/orders/checkout/`, () =>
      HttpResponse.json({ detail: 'Your wallet balance is too low for this order.', code: 'insufficient_funds' }, { status: 409 })))
    renderDrawer()
    await toConfirm()
    fireEvent.click(await screen.findByRole('radio', { name: /AshantiHub wallet/ }))
    fireEvent.click(screen.getByText('Confirm & Pay'))
    expect(await screen.findByText('Your wallet balance is too low for this order.')).toBeInTheDocument()
    expect(screen.queryByText('Order Confirmed!')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('← Back'))
    expect(await screen.findByText('Kente Cloth')).toBeInTheDocument()
  })

  it('test_ledger_off_checkout_is_unchanged', async () => {
    let body = null
    server.use(cart(), walletOff(), http.post(`${API}/api/orders/checkout/`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json(ORDER, { status: 201 })
    }))
    renderDrawer()
    await toConfirm()
    await waitFor(() => expect(screen.getByText('Confirm & Pay')).toBeEnabled())
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Confirm & Pay'))
    expect(await screen.findByTestId('stub-processing')).toHaveTextContent('undefined')
    fireEvent.click(screen.getByText('Simulate Pay'))
    await waitFor(() => expect(body).toEqual({ delivery_method: 'store_pickup', delivery_address: '', delivery_phone: '' }))
  })

  it('test_momo_post_carries_payment_method_momo_when_ledger_on', async () => {
    let body = null
    server.use(cart(), walletOn(), processing('4.50', '304.50'), http.post(`${API}/api/orders/checkout/`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ...ORDER, payment_method: 'momo', payment_processing: '4.50' }, { status: 201 })
    }))
    renderDrawer()
    await toConfirm()
    await screen.findByTestId('processing-line')
    await waitFor(() => expect(screen.getByText('Confirm & Pay')).toBeEnabled())
    fireEvent.click(screen.getByText('Confirm & Pay'))
    expect(await screen.findByTestId('stub-processing')).toHaveTextContent('4.50')
    fireEvent.click(screen.getByText('Simulate Pay'))
    await waitFor(() => expect(body).toEqual({ payment_method: 'momo', delivery_method: 'store_pickup', delivery_address: '', delivery_phone: '' }))
    fireEvent.click(screen.getByText('Done'))
    expect(await screen.findByText('Order Confirmed!')).toBeInTheDocument()
    expect(screen.getByText('Payment processing')).toBeInTheDocument()
    expect(screen.getByText('GH₵ 4.50', { selector: 'span' })).toBeInTheDocument()
  })

  it('test_staff_session_still_gets_the_staff_notice', async () => {
    server.use(cart(), walletOn(), processing())
    renderDrawer({ user: { fullName: 'Akosua Support', accountType: 'staff' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Checkout →' }))
    expect(screen.getByText("Staff accounts can't shop or sell. Sign out first.")).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
})

describe('MoMoPayment fee line', () => {
  function renderMomo(props) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={queryClient}>
        <MoMoPayment amount={300} purpose="AshantiHub Order Checkout" businessName="" onSuccess={vi.fn()} onClose={vi.fn()} {...props} />
      </QueryClientProvider>,
    )
  }

  it('test_momo_modal_has_no_made_up_fee_when_the_ledger_is_on', () => {
    const { container } = renderMomo({ processing: '4.50' })
    expect(screen.getByText('Payment processing')).toBeInTheDocument()
    expect(screen.getByText('GHS 4.50')).toBeInTheDocument()
    expect(screen.getByText('GHS 304.50')).toBeInTheDocument()
    expect(container.textContent).not.toContain('1.5%')
    expect(screen.getByText('MTN MoMo').parentElement).toHaveTextContent(/Dial \*170#$/)
    fireEvent.click(screen.getByText('MTN MoMo'))
    expect(container.textContent).not.toContain('1.5%')
    fireEvent.change(screen.getByPlaceholderText('0244 000 000'), { target: { value: '0244000000' } })
    expect(screen.getByText('Pay GHS 304.50 →')).toBeInTheDocument()
  })

  it('adds the server charge in whole pesewas', () => {
    renderMomo({ amount: 0.1, processing: '0.20' })
    expect(screen.getByText('GHS 0.30')).toBeInTheDocument()
  })

  it('test_momo_modal_keeps_the_simulated_fee_when_processing_is_undefined', () => {
    const { container } = renderMomo()
    expect(screen.getByText('Transaction fee (1.5%)')).toBeInTheDocument()
    expect(screen.getByText('GHS 4.50')).toBeInTheDocument()
    expect(screen.getByText('GHS 304.50')).toBeInTheDocument()
    expect(container.textContent).toContain('Dial *170# • 1.5% transaction fee')
  })
})
