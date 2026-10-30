import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from './mocks/server.js'
import CartDrawer from './components/CartDrawer.jsx'

// The slim mini-cart: lines, subtotal and "Go to cart". Checkout (address, delivery, payment) moved to
// components/shop/CheckoutPage.jsx and is tested in components/__tests__/CheckoutPage.test.jsx.

function renderDrawer(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CartDrawer
        onClose={vi.fn()}
        user={{ fullName: 'Ama Boateng', accountType: 'customer' }}
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
  it('is only a mini-cart: a subtotal and Go to cart, no checkout, address or payment step', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json(CART_WITH_ITEM)))
    renderDrawer({ onGoToCart: vi.fn() })
    await screen.findByText('Kente Cloth')
    expect(screen.getByText('Subtotal (2 items)')).toBeInTheDocument()
    expect(screen.getByTestId('mini-cart-subtotal')).toHaveTextContent('GHS 300.00')
    expect(screen.getByRole('button', { name: 'Go to cart' })).toBeInTheDocument()
    expect(screen.queryByText(/Checkout/)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Delivery address')).not.toBeInTheDocument()
  })

  it('offers a Go to cart link to the full cart page', async () => {
    const onGoToCart = vi.fn()
    renderDrawer({ onGoToCart })
    fireEvent.click(await screen.findByRole('button', { name: 'Go to cart' }))
    expect(onGoToCart).toHaveBeenCalledTimes(1)
  })

  it('shows an empty-cart state', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json({ id: 1, items: [], total: '0.00' })))
    renderDrawer()
    expect(await screen.findByText(/Your cart is empty/)).toBeInTheDocument()
  })

  it('names the variant on each cart line', async () => {
    server.use(http.get('http://localhost:8000/api/cart/', () => HttpResponse.json({
      ...CART_WITH_ITEM,
      items: [{ ...CART_WITH_ITEM.items[0], listing_name: 'Cake', variant: 3, variant_label: 'Vanilla' }],
    })))
    renderDrawer()
    expect(await screen.findByText('Cake (Vanilla)')).toBeInTheDocument()
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
})
