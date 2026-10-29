import { afterEach, describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../mocks/server.js'
import { gatedOpening } from '../../mocks/opening.js'
import CartPage from '../shop/CartPage.jsx'

afterEach(() => { localStorage.clear() })

const API = 'http://localhost:8000'
const customer = { accountType: 'customer', id: 1 }
const line = (id, extra = {}) => ({
  id, listing: 12, listing_name: 'Kente Stole', variant: 41, variant_label: 'Gold / Large', quantity: 2,
  unit_price_snapshot: '130.00', line_total: '260.00', added_at: '2026-10-28T08:05:00Z',
  listing_photo: `${API}/media/listings/kente.jpg`, seller_name: 'Akosua Ntoma', is_ashanti_direct: false,
  in_stock: true, stock_quantity: 8, ...extra,
})
const cartOf = (items, total) => ({ id: 5, total, created_at: '2026-10-28T08:00:00Z', updated_at: '2026-10-28T08:05:00Z', items })
const TWO = () => cartOf([line(88), line(89, { listing: 20, listing_name: 'Adinkra Cloth', variant: null, variant_label: '', quantity: 1, unit_price_snapshot: '40.00', line_total: '40.00', seller_name: 'Kofi Weaves', stock_quantity: 3 })], '300.00')
const guardOf = (checkout = {}) => ({
  active: true, limits: {}, shops: [], food_shops: 0, at_shop_limit: false, at_food_limit: false,
  checkout: { any: null, door_to_door: null, ...checkout },
})
const card = (id, name) => ({ id, name, effective_price: '50.00', price_amount: '50.00', was_price: null, main_photo: null, review_count: 0, avg_rating: null, category: { icon: 'x' } })

function serve(cart, { guard = guardOf(), onPatch, onDelete, onWishlist, alsoViewed, sponsored = [] } = {}) {
  const state = { cart }
  server.use(
    http.get(`${API}/api/cart/`, () => HttpResponse.json(state.cart)),
    http.get(`${API}/api/cart/guard/`, () => HttpResponse.json(guard)),
    http.patch(`${API}/api/cart/items/:id/`, async ({ params, request }) => {
      const body = await request.json()
      if (onPatch) { const r = onPatch(params.id, body, state); if (r) return r }
      return HttpResponse.json({ id: Number(params.id), quantity: body.quantity })
    }),
    http.delete(`${API}/api/cart/items/:id/`, ({ params }) => {
      if (onDelete) onDelete(params.id, state)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/api/wishlist/`, async ({ request }) => {
      const body = await request.json()
      if (onWishlist) { const r = onWishlist(body); if (r) return r }
      return HttpResponse.json({ id: 1, listing: card(body.listing, 'x') }, { status: 201 })
    }),
    http.get(`${API}/api/storefront/sponsored/`, () => HttpResponse.json(sponsored)),
    http.get(`${API}/api/listings/:id/also-viewed/`, () => HttpResponse.json(alsoViewed ?? { basis: 'same_category', results: [] })),
  )
  return state
}

function renderPage(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onNavigate = vi.fn()
  const ui = render(
    <QueryClientProvider client={client}>
      <CartPage user={customer} currency="GHS" onNavigate={onNavigate} {...props} />
    </QueryClientProvider>,
  )
  return { ...ui, onNavigate }
}
const proceed = () => screen.getByRole('button', { name: /proceed to checkout/i })

describe('CartPage', () => {
  test('test_lists_each_line_with_variant_label_and_sold_by', async () => {
    serve(TWO())
    renderPage()
    expect(await screen.findByRole('link', { name: 'Kente Stole' })).toHaveAttribute('href', '/business/12')
    expect(screen.getByRole('heading', { name: 'Shopping Cart' })).toBeInTheDocument()
    expect(screen.getByText('Gold / Large')).toBeInTheDocument()
    expect(screen.getByText('Sold by Akosua Ntoma')).toBeInTheDocument()
    expect(screen.getByText('Sold by Kofi Weaves')).toBeInTheDocument()
    expect(screen.getByText('Only 3 left')).toBeInTheDocument()
    expect(screen.getByText('In stock')).toBeInTheDocument()
    expect(screen.getByText('Prices and availability can change. Each line keeps the price from when you added it; changing the quantity updates it to today’s price.')).toBeInTheDocument()
    expect(screen.getByText('Delivery fee is worked out at checkout from your delivery pin.')).toBeInTheDocument()
  })

  test('test_quantity_plus_minus_patch_the_line_and_refetch', async () => {
    const patches = []
    const state = serve(TWO(), {
      onPatch: (id, body, st) => { patches.push([id, body]); st.cart = cartOf([line(88, { quantity: body.quantity, line_total: '390.00' }), st.cart.items[1]], '430.00') },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Increase quantity of Kente Stole' }))
    await waitFor(() => expect(patches).toEqual([['88', { quantity: 3 }]]))
    expect(await screen.findByText('GHS 430.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Decrease quantity of Kente Stole' }))
    await waitFor(() => expect(patches[1]).toEqual(['88', { quantity: 2 }]))
    expect(state.cart.items).toHaveLength(2)
  })

  test('test_minus_at_one_shows_a_trash_that_deletes', async () => {
    const deleted = []
    serve(TWO(), { onDelete: (id, st) => { deleted.push(id); st.cart = cartOf([st.cart.items[0]], '260.00') } })
    renderPage()
    expect(await screen.findByRole('button', { name: 'Decrease quantity of Kente Stole' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Decrease quantity of Adinkra Cloth' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Adinkra Cloth from cart' }))
    await waitFor(() => expect(deleted).toEqual(['89']))
    await waitFor(() => expect(screen.queryByText('Adinkra Cloth')).toBeNull())
  })

  test('test_save_for_later_adds_to_the_wishlist_then_deletes_the_line', async () => {
    const order = []
    serve(TWO(), {
      onWishlist: (body) => { order.push(['wishlist', body]) },
      onDelete: (id, st) => { order.push(['delete', id]); st.cart = cartOf([st.cart.items[1]], '40.00') },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Save Kente Stole for later' }))
    await waitFor(() => expect(order).toEqual([['wishlist', { listing: 12 }], ['delete', '88']]))
    await waitFor(() => expect(screen.queryByText('Gold / Large')).toBeNull())
  })

  test('test_save_for_later_failure_keeps_the_line', async () => {
    const deleted = []
    serve(TWO(), {
      onWishlist: () => HttpResponse.json({ listing: ["This item can't be saved."] }, { status: 400 }),
      onDelete: (id) => deleted.push(id),
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Save Kente Stole for later' }))
    expect(await screen.findByText("This item can't be saved.")).toBeInTheDocument()
    expect(deleted).toEqual([])
    expect(screen.getByRole('link', { name: 'Kente Stole' })).toBeInTheDocument()
  })

  test('test_subtotal_matches_the_server_total', async () => {
    serve(TWO())
    renderPage()
    const sub = await screen.findByTestId('cart-subtotal')
    expect(within(sub).getByText('Subtotal (3 items)')).toBeInTheDocument()
    expect(within(sub).getByText('GHS 300.00')).toBeInTheDocument()
  })

  test('test_cart_money_stays_in_ghs_whatever_the_display_currency', async () => {
    serve(TWO())
    renderPage({ currency: 'USD' })
    const sub = await screen.findByTestId('cart-subtotal')
    expect(within(sub).getByText('GHS 300.00')).toBeInTheDocument()
    expect(screen.getByText('GHS 260.00')).toBeInTheDocument()
    expect(screen.getByText('GHS 130.00 each')).toBeInTheDocument()
    expect(screen.queryByText(/USD/)).toBeNull()
  })

  test('test_proceed_goes_to_checkout_when_allowed', async () => {
    serve(TWO())
    const { onNavigate } = renderPage()
    await screen.findByTestId('cart-subtotal')
    await waitFor(() => expect(proceed()).toBeEnabled())
    fireEvent.click(proceed())
    expect(onNavigate).toHaveBeenCalledWith('/checkout')
  })

  test('test_proceed_is_disabled_before_opening_with_the_reason', async () => {
    server.use(gatedOpening({ opensAt: '2026-11-06T06:00:00Z', serverNow: '2026-10-29T10:00:00Z' }))
    serve(TWO())
    renderPage()
    expect(await screen.findByText('Opens 6 Nov')).toBeInTheDocument()
    expect(proceed()).toBeDisabled()
  })

  test('test_proceed_is_disabled_with_a_guard_message', async () => {
    const detail = 'Your delivery can include up to 4 shops. Your cart has 5. Remove 1 to check out.'
    serve(TWO(), { guard: guardOf({ any: { detail, code: 'shop_limit' } }) })
    renderPage()
    expect(await screen.findByText(detail)).toBeInTheDocument()
    expect(proceed()).toBeDisabled()
  })

  test('test_staff_session_sees_the_staff_notice_instead_of_checkout', async () => {
    serve(TWO())
    const { onNavigate } = renderPage({ user: { accountType: 'staff' } })
    await screen.findByTestId('cart-subtotal')
    fireEvent.click(proceed())
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onNavigate).not.toHaveBeenCalled()
  })

  test('test_empty_cart_state_and_no_checkout_button', async () => {
    serve(cartOf([], '0.00'), { sponsored: [card(7, 'Sponsored Bag')] })
    const { onNavigate } = renderPage()
    expect(await screen.findByText(/your cart is empty/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /proceed to checkout/i })).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Sponsored products' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /also viewed|more in this category/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Continue shopping' }))
    expect(onNavigate).toHaveBeenCalledWith('/')
  })

  test('test_stock_refusal_message_from_the_server_is_shown_on_the_line', async () => {
    serve(TWO(), { onPatch: () => HttpResponse.json({ detail: 'Only 3 of Kente Stole left in stock.' }, { status: 400 }) })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Increase quantity of Kente Stole' }))
    const row = screen.getByTestId('cart-line-88')
    expect(await within(row).findByText('Only 3 of Kente Stole left in stock.')).toBeInTheDocument()
    expect(within(screen.getByTestId('cart-line-89')).queryByText(/left in stock/)).toBeNull()
  })

  test('test_no_gift_or_compare_controls', async () => {
    serve(TWO())
    renderPage()
    await screen.findByTestId('cart-subtotal')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByText(/gift|compare|share/i)).toBeNull()
  })

  test('test_carousels_use_the_honest_heading_and_the_first_lines_listing', async () => {
    let anchored = null
    serve(TWO(), { sponsored: [card(7, 'Sponsored Bag')] })
    // registered after serve() so it wins over serve()'s default also-viewed handler
    server.use(http.get(`${API}/api/listings/:id/also-viewed/`, ({ params }) => { anchored = params.id; return HttpResponse.json({ basis: 'same_category', results: [card(31, 'Cousin Stole')] }) }))
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Sponsored products' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'More like the first item in your cart' })).toBeInTheDocument()
    expect(anchored).toBe('12')
  })

  test('test_a_failed_cart_read_says_so_and_offers_a_retry_instead_of_blaming_the_account', async () => {
    let reads = 0
    server.use(http.get(`${API}/api/cart/`, () => { reads += 1; return reads === 1 ? new HttpResponse(null, { status: 500 }) : HttpResponse.json(TWO()) }))
    renderPage()
    expect(await screen.findByText('We couldn\'t load your cart. Try again.')).toBeInTheDocument()
    expect(screen.queryByText('Carts are for customer accounts.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'Kente Stole' })).toBeInTheDocument()
  })

  test('test_only_a_403_for_a_non_customer_reads_as_carts_are_for_customer_accounts', async () => {
    server.use(http.get(`${API}/api/cart/`, () => HttpResponse.json({ detail: 'no' }, { status: 403 })))
    renderPage({ user: { accountType: 'business_owner', id: 9 } })
    expect(await screen.findByText('Carts are for customer accounts.')).toBeInTheDocument()
  })

  test('test_a_session_still_loading_never_sees_sign_in_to_see_your_cart', async () => {
    serve(TWO())
    renderPage({ user: null, authLoading: true, onSignIn: vi.fn() })
    expect(screen.getByText(/Loading your cart/)).toBeInTheDocument()
    expect(screen.queryByText('Sign in to see your cart.')).not.toBeInTheDocument()
  })

  test('test_plus_stops_at_the_counted_stock', async () => {
    serve(cartOf([line(88, { quantity: 3, stock_quantity: 3 })], '390.00'))
    renderPage()
    expect(await screen.findByRole('button', { name: 'Increase quantity of Kente Stole' })).toBeDisabled()
  })

  test('test_save_for_later_goes_through_the_one_wishlist_path_and_refreshes_it', async () => {
    let wishlistReads = 0
    serve(TWO())
    server.use(http.get(`${API}/api/wishlist/`, () => { wishlistReads += 1; return HttpResponse.json([]) }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Save Kente Stole for later' }))
    await waitFor(() => expect(wishlistReads).toBeGreaterThan(1))
  })
})
