import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import CartDrawer from './components/CartDrawer.jsx'

function StubPayment({ amount, onSuccess, onClose }) {
  return (
    <div>
      <div>Pay {amount}</div>
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

const CART_WITH_ITEM = {
  id: 1,
  items: [
    { id: 10, listing: 5, listing_name: 'Kente Cloth', quantity: 2, unit_price_snapshot: '150.00', line_total: '300.00', added_at: '2026-07-10T00:00:00Z' },
  ],
  total: '300.00',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-10T00:00:00Z',
}

describe('CartDrawer', () => {
  it('shows an empty-cart state', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json({ id: 1, items: [], total: '0.00' })))
    renderDrawer()
    expect(await screen.findByText(/Your cart is empty/)).toBeInTheDocument()
  })

  it('shows a loading state before the cart resolves', () => {
    server.use(http.get('http://localhost:8000/api/cart/', async () => {
      await new Promise((r) => setTimeout(r, 50))
      return HttpResponse.json({ id: 1, items: [], total: '0.00' })
    }))
    renderDrawer()
    expect(screen.getByText(/Loading your cart/)).toBeInTheDocument()
  })

  it('shows an error state with a retry option', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => new HttpResponse(null, { status: 500 })))
    renderDrawer()
    expect(await screen.findByText(/Could not load your cart/)).toBeInTheDocument()
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('lists cart items with quantity and line total, and the running total', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)))
    renderDrawer()
    expect(await screen.findByText('Kente Cloth')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getAllByText('GHS 300.00').length).toBeGreaterThan(0)
  })

  it('increases quantity via the + stepper', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)))
    let patchedBody
    server.use(
      http.patch('http://localhost:8000/api/cart/items/10/', async ({ request }) => {
        patchedBody = await request.json()
        return HttpResponse.json({ ...CART_WITH_ITEM.items[0], quantity: patchedBody.quantity, line_total: '450.00' })
      }),
    )
    renderDrawer()
    await screen.findByText('Kente Cloth')
    fireEvent.click(screen.getByLabelText('Increase quantity of Kente Cloth'))
    await waitFor(() => expect(patchedBody).toEqual({ quantity: 3 }))
  })

  it('removes an item via the remove button', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)))
    let deleteCalled = false
    server.use(
      http.delete('http://localhost:8000/api/cart/items/10/', () => {
        deleteCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderDrawer()
    await screen.findByText('Kente Cloth')
    fireEvent.click(screen.getByLabelText('Remove Kente Cloth from cart'))
    await waitFor(() => expect(deleteCalled).toBe(true))
  })

  it('calls onClose when the backdrop is clicked', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json({ id: 1, items: [], total: '0.00' })))
    const onClose = vi.fn()
    const { container } = renderDrawer({ onClose })
    await screen.findByText(/Your cart is empty/)
    fireEvent.click(container.firstChild)
    expect(onClose).toHaveBeenCalled()
  })

  it('walks through checkout: confirm -> pay -> order confirmation', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)))
    let checkoutCalled = false
    server.use(
      http.post('http://localhost:8000/api/orders/checkout/', () => {
        checkoutCalled = true
        return HttpResponse.json(
          { id: 42, status: 'paid', total_amount: '300.00', placed_at: '2026-07-14T00:00:00Z', items: [{ id: 1, listing_name: 'Kente Cloth', quantity: 2, line_total: '300.00' }] },
          { status: 201 },
        )
      }),
    )
    renderDrawer()
    await screen.findByText('Kente Cloth')

    fireEvent.click(screen.getByText('Checkout →'))
    expect(await screen.findByText('Confirm your order')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Confirm & Pay'))
    expect(await screen.findByText(/Pay 300/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Simulate Pay'))
    await waitFor(() => expect(checkoutCalled).toBe(true))

    fireEvent.click(screen.getByText('Done'))
    expect(await screen.findByText('Order Confirmed!')).toBeInTheDocument()
    expect(screen.getByText('#42')).toBeInTheDocument()
  })

  it('sends the door-to-door delivery method and address at checkout', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)))
    let checkoutBody = null
    server.use(
      http.post('http://localhost:8000/api/orders/checkout/', async ({ request }) => {
        checkoutBody = await request.json()
        return HttpResponse.json(
          { id: 43, status: 'paid', total_amount: '300.00', placed_at: '2026-07-14T00:00:00Z', delivery_method: 'door_to_door', items: [] },
          { status: 201 },
        )
      }),
    )
    renderDrawer()
    await screen.findByText('Kente Cloth')
    fireEvent.click(screen.getByText('Checkout →'))
    await screen.findByText('Confirm your order')

    fireEvent.click(screen.getByText('🚚 Door-to-door'))
    // Pay stays disabled until an address + phone are entered.
    expect(screen.getByText('Confirm & Pay')).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Delivery address'), { target: { value: '12 Ash Road, Kumasi' } })
    fireEvent.change(screen.getByPlaceholderText('Contact phone for delivery'), { target: { value: '+233200112233' } })
    expect(screen.getByText('Confirm & Pay')).toBeEnabled()

    fireEvent.click(screen.getByText('Confirm & Pay'))
    fireEvent.click(await screen.findByText('Simulate Pay'))
    await waitFor(() => expect(checkoutBody).toEqual({
      delivery_method: 'door_to_door',
      delivery_address: '12 Ash Road, Kumasi',
      delivery_phone: '+233200112233',
    }))
  })

  it('fills the delivery address from the location picker (use my location / dropped pin)', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)))
    renderDrawer()
    await screen.findByText('Kente Cloth')
    fireEvent.click(screen.getByText('Checkout →'))
    await screen.findByText('Confirm your order')
    fireEvent.click(screen.getByText('🚚 Door-to-door'))
    // The address field starts empty; using the location picker fills it (the
    // LocationPicker stub reports both coordinates and a reverse-geocoded address).
    expect(screen.getByPlaceholderText('Delivery address')).toHaveValue('')
    fireEvent.click(screen.getByText('drop-pin'))
    expect(screen.getByPlaceholderText('Delivery address')).toHaveValue('KNUST Ave, Kumasi')
  })

  it('keeps the payment amount stable even after checkout empties the cart mid-payment', async () => {
    // Regression test: handlePaymentSuccess's post-checkout refetch() used to
    // feed PaymentComponent's `amount` prop straight from the live `cart?.total`
    // query, which drops to 0 once the cart is emptied server-side — visible in
    // the real MoMoPayment component (which recomputes `total` from `amount` on
    // every render) as "Payment Successful! Your payment of GHS 0.00 has been
    // received." right as the success screen appeared. Caught via manual
    // browser verification, not by the original test suite, because this stub
    // renders `amount` directly without MoMoPayment's live-recompute behavior —
    // so this test asserts on the *prop* CartDrawer passes down, which is what
    // was actually wrong, rather than on MoMoPayment's internal rendering.
    let cartCallCount = 0
    server.use(
      http.get('http://localhost:8000/api/cart/', () => {
        cartCallCount += 1
        // First call (initial load) returns the item; every call after
        // checkout (triggered by handlePaymentSuccess's refetch()) returns
        // an emptied cart, mirroring the real backend's post-checkout state.
        return HttpResponse.json(cartCallCount === 1 ? CART_WITH_ITEM : { id: 1, items: [], total: '0.00' })
      }),
    )
    server.use(
      http.post('http://localhost:8000/api/orders/checkout/', () =>
        HttpResponse.json(
          { id: 42, status: 'paid', total_amount: '300.00', placed_at: '2026-07-14T00:00:00Z', items: [{ id: 1, listing_name: 'Kente Cloth', quantity: 2, line_total: '300.00' }] },
          { status: 201 },
        ),
      ),
    )
    renderDrawer()
    await screen.findByText('Kente Cloth')

    fireEvent.click(screen.getByText('Checkout →'))
    await screen.findByText('Confirm your order')
    fireEvent.click(screen.getByText('Confirm & Pay'))
    expect(await screen.findByText(/Pay 300/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Simulate Pay'))
    await waitFor(() => expect(cartCallCount).toBeGreaterThan(1))

    // The cart has now been refetched to empty in the background, but the
    // payment modal (still open) must keep showing the original amount.
    expect(screen.getByText(/Pay 300/)).toBeInTheDocument()
    expect(screen.queryByText(/Pay 0/)).not.toBeInTheDocument()
  })

  it('does not call checkout if the payment step is cancelled before paying', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)))
    let checkoutCalled = false
    server.use(
      http.post('http://localhost:8000/api/orders/checkout/', () => {
        checkoutCalled = true
        return HttpResponse.json({ id: 1, status: 'paid', total_amount: '300.00', placed_at: '2026-07-14T00:00:00Z', items: [] }, { status: 201 })
      }),
    )
    renderDrawer()
    await screen.findByText('Kente Cloth')
    fireEvent.click(screen.getByText('Checkout →'))
    await screen.findByText('Confirm your order')
    fireEvent.click(screen.getByText('Confirm & Pay'))
    await screen.findByText(/Pay 300/)
    fireEvent.click(screen.getByText('Done'))
    expect(checkoutCalled).toBe(false)
    expect(await screen.findByText('Confirm your order')).toBeInTheDocument()
  })
})
