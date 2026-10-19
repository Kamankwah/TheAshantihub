import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import { gatedOpening } from './mocks/opening.js'
import { setStoredAuth } from './apiClient.js'
import CartDrawer from './components/CartDrawer.jsx'

// Same stub as test/setup.js plus a second pin, so a test can move the pin from one point to another.
vi.mock('./components/LocationPicker.jsx', async () => {
  const { createElement, Fragment } = await import('react')
  return {
    default: ({ onChange, onAddress }) => createElement(Fragment, null,
      createElement('button', { type: 'button', onClick: () => { onChange(6.7, -1.62); if (onAddress) onAddress('KNUST Ave, Kumasi') } }, 'drop-pin'),
      createElement('button', { type: 'button', onClick: () => onChange(6.69, -1.62) }, 'drop-pin-out')),
  }
})

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

describe('CartDrawer — staff session is view-only', () => {
  // App.jsx never opens the cart for staff (it's customer-only), so this is
  // the defence-in-depth layer: checkout itself refuses a staff session with
  // the one shared staff notice.
  it('Checkout shows the staff notice and never reaches the confirm/pay step', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)))
    renderDrawer({ user: { fullName: 'Akosua Support', accountType: 'staff' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Checkout →' }))
    expect(screen.getByText("Staff accounts can't shop or sell. Sign out first.")).toBeInTheDocument()
    expect(screen.queryByText('Confirm your order')).not.toBeInTheDocument()
  })
})

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

  it('shows the out-of-area message instead of "no delivery fee is added" for a pin outside the region', async () => {
    const MESSAGE = 'We only deliver within the Ashanti Region for now.'
    server.use(
      http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)),
      http.get('http://localhost:8000/api/marketing/promos/public/', () => HttpResponse.json({ enabled: true, flash_sales: [] })),
      http.post('http://localhost:8000/api/marketing/cart/quote/', () => HttpResponse.json({
        enabled: true, total: '300.00',
        delivery: { fee: null, fee_status: 'out_of_area', waived: false, waiver_name: null, waived_fee: null, mixed_note: null, message: MESSAGE },
      })),
    )
    renderDrawer()
    await screen.findByText('Kente Cloth')
    fireEvent.click(screen.getByText('Checkout →'))
    await screen.findByText('Confirm your order')
    fireEvent.click(screen.getByText('🚚 Door-to-door'))
    fireEvent.click(screen.getByText('drop-pin'))
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(/no delivery fee is added/i)).not.toBeInTheDocument()
  })

  it('disables Confirm & Pay for an out-of-area pin so the payment step cannot start', async () => {
    const MESSAGE = 'We only deliver within the Ashanti Region for now.'
    server.use(
      http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)),
      http.get('http://localhost:8000/api/marketing/promos/public/', () => HttpResponse.json({ enabled: true, flash_sales: [] })),
      http.post('http://localhost:8000/api/marketing/cart/quote/', () => HttpResponse.json({
        enabled: true, total: '300.00',
        delivery: { fee: null, fee_status: 'out_of_area', waived: false, waiver_name: null, waived_fee: null, mixed_note: null, message: MESSAGE },
      })),
    )
    renderDrawer()
    await screen.findByText('Kente Cloth')
    fireEvent.click(screen.getByText('Checkout →'))
    await screen.findByText('Confirm your order')
    fireEvent.click(screen.getByText('🚚 Door-to-door'))
    fireEvent.change(screen.getByPlaceholderText('Delivery address'), { target: { value: 'Accra' } })
    fireEvent.change(screen.getByPlaceholderText('Contact phone for delivery'), { target: { value: '+233200112233' } })
    fireEvent.click(screen.getByText('drop-pin'))
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument()
    const pay = screen.getByRole('button', { name: /Confirm & Pay/ })
    expect(pay).toBeDisabled()
    fireEvent.click(pay)
    expect(screen.queryByText('Simulate Pay')).not.toBeInTheDocument()
  })

  it('keeps Confirm & Pay enabled for a normal door-to-door quote', async () => {
    server.use(
      http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)),
      http.get('http://localhost:8000/api/marketing/promos/public/', () => HttpResponse.json({ enabled: true, flash_sales: [] })),
      http.post('http://localhost:8000/api/marketing/cart/quote/', () => HttpResponse.json({
        enabled: true, total: '300.00',
        delivery: { fee: '12.00', fee_status: 'ok', waived: false, waiver_name: null, waived_fee: null, mixed_note: null },
      })),
    )
    renderDrawer()
    await screen.findByText('Kente Cloth')
    fireEvent.click(screen.getByText('Checkout →'))
    await screen.findByText('Confirm your order')
    fireEvent.click(screen.getByText('🚚 Door-to-door'))
    fireEvent.change(screen.getByPlaceholderText('Delivery address'), { target: { value: 'Adum' } })
    fireEvent.change(screen.getByPlaceholderText('Contact phone for delivery'), { target: { value: '+233200112233' } })
    fireEvent.click(screen.getByText('drop-pin'))
    await screen.findByText(/Delivery: GHS 12.00/)
    expect(screen.getByRole('button', { name: /Confirm & Pay/ })).toBeEnabled()
  })

  const quoteHandlers = (quoteFor) => [
    http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)),
    http.get('http://localhost:8000/api/marketing/promos/public/', () => HttpResponse.json({ enabled: true, flash_sales: [] })),
    http.post('http://localhost:8000/api/marketing/cart/quote/', async ({ request }) => quoteFor(await request.json())),
  ]
  const OK_DELIVERY = { enabled: true, total: '300.00', delivery: { fee: '12.00', fee_status: 'ok', waived: false, waiver_name: null, waived_fee: null, mixed_note: null } }
  const OUT_DELIVERY = { enabled: true, total: '300.00', delivery: { fee: null, fee_status: 'out_of_area', waived: false, waiver_name: null, waived_fee: null, mixed_note: null, message: 'We only deliver within the Ashanti Region for now.' } }
  async function openDoorToDoor() {
    await screen.findByText('Kente Cloth')
    fireEvent.click(screen.getByText('Checkout →'))
    await screen.findByText('Confirm your order')
    fireEvent.click(screen.getByText('🚚 Door-to-door'))
    fireEvent.change(screen.getByPlaceholderText('Delivery address'), { target: { value: 'Adum' } })
    fireEvent.change(screen.getByPlaceholderText('Contact phone for delivery'), { target: { value: '+233200112233' } })
  }

  it('keeps Confirm & Pay disabled while the quote for a moved pin is pending and once it resolves out of area', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    server.use(...quoteHandlers(async (body) => {
      if (body.delivery_lat === 6.69) { await gate; return HttpResponse.json(OUT_DELIVERY) }
      return HttpResponse.json(OK_DELIVERY)
    }))
    renderDrawer()
    await openDoorToDoor()
    fireEvent.click(screen.getByText('drop-pin'))
    await screen.findByText(/Delivery: GHS 12.00/)
    expect(screen.getByRole('button', { name: /Confirm & Pay/ })).toBeEnabled()
    fireEvent.click(screen.getByText('drop-pin-out'))
    expect(screen.getByRole('button', { name: /Confirm & Pay/ })).toBeDisabled()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByRole('button', { name: /Confirm & Pay/ })).toBeDisabled()
    release()
    expect(await screen.findByText('We only deliver within the Ashanti Region for now.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirm & Pay/ })).toBeDisabled()
  })

  it('keeps Confirm & Pay disabled and says so when the delivery quote request fails', async () => {
    server.use(...quoteHandlers(() => HttpResponse.json({ detail: 'boom' }, { status: 500 })))
    renderDrawer()
    await openDoorToDoor()
    fireEvent.click(screen.getByText('drop-pin'))
    expect(await screen.findByText("We couldn't check delivery to this location yet. Try again.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirm & Pay/ })).toBeDisabled()
  })

  it('cannot check the region while promotions are off, so Confirm & Pay stays enabled (documented limit)', async () => {
    server.use(
      http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)),
      http.get('http://localhost:8000/api/marketing/promos/public/', () => HttpResponse.json({ enabled: false, flash_sales: [] })),
    )
    renderDrawer()
    await openDoorToDoor()
    fireEvent.click(screen.getByText('drop-pin'))
    expect(screen.getByRole('button', { name: /Confirm & Pay/ })).toBeEnabled()
  })

  it('shows the server explanation when checkout refuses an out-of-area delivery point', async () => {
    server.use(
      http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)),
      http.post('http://localhost:8000/api/orders/checkout/', () => HttpResponse.json(
        { detail: 'We only deliver within the Ashanti Region for now.', code: 'out_of_area' }, { status: 400 },
      )),
    )
    renderDrawer()
    await screen.findByText('Kente Cloth')
    fireEvent.click(screen.getByText('Checkout →'))
    await screen.findByText('Confirm your order')
    fireEvent.click(screen.getByText('🚚 Door-to-door'))
    fireEvent.change(screen.getByPlaceholderText('Delivery address'), { target: { value: 'Accra' } })
    fireEvent.change(screen.getByPlaceholderText('Contact phone for delivery'), { target: { value: '+233200112233' } })
    fireEvent.click(screen.getByText('Confirm & Pay'))
    fireEvent.click(await screen.findByText('Simulate Pay'))
    const alertText = await screen.findByText(/We only deliver within the Ashanti Region for now\./)
    expect(alertText).toHaveTextContent(/Your order was not placed\./)
    expect(alertText).toHaveTextContent(/Payment reference: \S+/)
    expect(screen.queryByText(/Payment was confirmed/)).not.toBeInTheDocument()
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

describe('CartDrawer and the delivery limits', () => {
  const guard = (checkout) => http.get('http://localhost:8000/api/cart/guard/', () => HttpResponse.json({ active: true, limits: {}, shops: [], food_shops: 0, at_shop_limit: true, at_food_limit: false, checkout }))

  it('a cart over the limit cannot be paid for door-to-door, and says why', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)), guard({ any: null, door_to_door: { detail: 'Your delivery can include up to 4 shops. Your cart has 5. Remove 1 to check out.', code: 'shop_limit' } }))
    renderDrawer()
    fireEvent.click(await screen.findByText('Checkout →'))
    await screen.findByText('Confirm your order')
    expect(screen.getByText('Confirm & Pay')).toBeEnabled() // store pickup has no rider
    fireEvent.click(screen.getByText('🚚 Door-to-door'))
    fireEvent.change(screen.getByPlaceholderText('Delivery address'), { target: { value: '12 Ash Road, Kumasi' } })
    fireEvent.change(screen.getByPlaceholderText('Contact phone for delivery'), { target: { value: '+233200112233' } })
    expect(await screen.findByTestId('cart-guard-block')).toHaveTextContent('Remove 1 to check out')
    expect(screen.getByText('Confirm & Pay')).toBeDisabled()
  })

  it('a service line blocks checkout whatever the method', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)), guard({ any: { detail: 'Services are requested separately, and stays are booked separately. Remove them from your cart to check out.', code: 'not_deliverable' }, door_to_door: null }))
    renderDrawer()
    fireEvent.click(await screen.findByText('Checkout →'))
    expect(await screen.findByTestId('cart-guard-block')).toHaveTextContent('Services are requested separately')
    expect(screen.getByText('Confirm & Pay')).toBeDisabled()
  })

  const LIMIT = { detail: 'Your delivery can include up to 4 shops. Your cart has 5. Remove 1 to check out.', code: 'shop_limit' }
  const toDoorToDoor = async () => {
    fireEvent.click(screen.getByText('🚚 Door-to-door'))
    fireEvent.change(screen.getByPlaceholderText('Delivery address'), { target: { value: 'Adum' } })
    fireEvent.change(screen.getByPlaceholderText('Contact phone for delivery'), { target: { value: '+233200112233' } })
  }

  it('Confirm & Pay stays off while the limits are still loading', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)), http.get('http://localhost:8000/api/cart/guard/', () => new Promise(() => {})))
    renderDrawer()
    fireEvent.click(await screen.findByText('Checkout →'))
    await screen.findByText('Confirm your order')
    expect(screen.getByTestId('cart-guard-unchecked')).toHaveTextContent('Checking your delivery limits')
    expect(screen.getByText('Confirm & Pay')).toBeDisabled()
  })

  it('Confirm & Pay stays off, with a plain line, when the limits could not be read', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)), http.get('http://localhost:8000/api/cart/guard/', () => HttpResponse.json({ detail: 'x' }, { status: 500 })))
    renderDrawer()
    fireEvent.click(await screen.findByText('Checkout →'))
    expect(await screen.findByTestId('cart-guard-unchecked')).toHaveTextContent("couldn't check your delivery limits")
    expect(screen.getByText('Confirm & Pay')).toBeDisabled()
  })

  it('a delivery-limit block says store pickup is still available; a service block does not', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)), guard({ any: null, door_to_door: LIMIT }))
    const { unmount } = renderDrawer()
    fireEvent.click(await screen.findByText('Checkout →'))
    await screen.findByText('Confirm your order')
    await toDoorToDoor()
    expect(await screen.findByTestId('cart-guard-block')).toHaveTextContent('Store pickup is still available.')
    unmount()
    server.use(guard({ any: { detail: 'Services are requested separately, and stays are booked separately. Remove them from your cart to check out.', code: 'not_deliverable' }, door_to_door: null }))
    renderDrawer()
    fireEvent.click(await screen.findByText('Checkout →'))
    expect(await screen.findByTestId('cart-guard-block')).not.toHaveTextContent('Store pickup')
  })

  describe('multi-shop fee breakdown', () => {
    const quote = (delivery) => [
      http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)),
      http.get('http://localhost:8000/api/marketing/promos/public/', () => HttpResponse.json({ enabled: true, flash_sales: [] })),
      http.post('http://localhost:8000/api/marketing/cart/quote/', () => HttpResponse.json({ enabled: true, total: '300.00', delivery })),
    ]
    const LINES = [{ label: 'Base', amount: '8.00' }, { label: 'Extra pickup', amount: '0.00' }]
    const open = async () => {
      renderDrawer()
      fireEvent.click(await screen.findByText('Checkout →'))
      await screen.findByText('Confirm your order')
      await toDoorToDoor()
      fireEvent.click(screen.getByText('drop-pin'))
    }

    it('lists every line, including a 0.00 one, and flags a straight-line estimate', async () => {
      server.use(...quote({ fee: '8.00', fee_status: 'ok', waived: false, mixed_note: null, lines: LINES, route: { stops: 2, planned: false } }))
      await open()
      const list = await screen.findByRole('list', { name: 'Delivery fee breakdown' })
      expect(list).toHaveTextContent('Base: GHS 8.00')
      expect(list).toHaveTextContent('Extra pickup: GHS 0.00')
      expect(screen.getByText(/straight-line estimate/)).toBeInTheDocument()
      expect(screen.getByText('Delivery breakdown:')).toBeInTheDocument()
    })

    it('labels the lines as value, not a charge, when delivery is free', async () => {
      server.use(...quote({ fee: '0.00', fee_status: 'ok', waived: true, waiver_name: 'Free week', waived_fee: '8.00', mixed_note: null, lines: LINES, route: { stops: 2, planned: true } }))
      await open()
      expect(await screen.findByText('Delivery value (not charged):')).toBeInTheDocument()
      expect(screen.queryByText(/straight-line estimate/)).not.toBeInTheDocument()
    })
  })
})

describe('CartDrawer and the after-hours delivery notice', () => {
  const preview = (body) => http.get('http://localhost:8000/api/orders/delivery-preview/', () => HttpResponse.json(body))
  // 2026-10-20 is a Tuesday; Accra is UTC+0, so 08:00Z reads "Tue 08:00".
  const DEFERRED = { delivery_from: '2026-10-20T08:00:00Z', delivered_from: '2026-10-20T08:00:00Z', deferred: true }
  // A preview handler that tells the test when the request arrived, so absence is asserted after the answer was served.
  const watchedPreview = (body, status = 200) => {
    let seen
    const hit = new Promise((resolve) => { seen = resolve })
    const handler = http.get('http://localhost:8000/api/orders/delivery-preview/', () => { seen(); return HttpResponse.json(body, { status }) })
    const settled = async () => {
      await hit
      await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) // let the served response reach the component
    }
    return { handler, settled }
  }
  const openDoorToDoor = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Checkout →' }))
    fireEvent.click(screen.getByText('🚚 Door-to-door'))
  }

  it('says the shop is closed and when delivery starts (business hours)', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)), preview({ ...DEFERRED, source: 'business_hours' }))
    renderDrawer()
    await openDoorToDoor()
    expect(await screen.findByTestId('cart-after-hours')).toHaveTextContent('Shop is closed now. Delivery starts Tue 08:00.')
  })

  it('never says the shop is closed when only platform hours defer it', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)), preview({ ...DEFERRED, source: 'platform' }))
    renderDrawer()
    await openDoorToDoor()
    const note = await screen.findByTestId('cart-after-hours')
    expect(note).toHaveTextContent('Delivery starts Tue 08:00.')
    expect(note).not.toHaveTextContent(/closed/i)
  })

  it('shows no notice when the shop is open', async () => {
    const open = watchedPreview({ delivery_from: null, delivered_from: null, deferred: false, source: null })
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)), open.handler)
    renderDrawer()
    await openDoorToDoor()
    await open.settled()
    expect(screen.queryByTestId('cart-after-hours')).not.toBeInTheDocument()
  })

  it('shows the notice with promotions off, and nothing when the preview fails or for store pickup', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)), preview({ ...DEFERRED, source: 'business_hours' }))
    const { unmount } = renderDrawer()
    fireEvent.click(await screen.findByRole('button', { name: 'Checkout →' }))
    expect(screen.queryByTestId('cart-after-hours')).not.toBeInTheDocument() // store pickup is the default
    fireEvent.click(screen.getByText('🚚 Door-to-door'))
    expect(await screen.findByTestId('cart-after-hours')).toBeInTheDocument()
    unmount()
    const failing = watchedPreview({ detail: 'x' }, 500)
    server.use(failing.handler)
    renderDrawer()
    await openDoorToDoor()
    await failing.settled()
    expect(screen.queryByTestId('cart-after-hours')).not.toBeInTheDocument()
  })
})
