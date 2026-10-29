import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Card } from '../../App.jsx'
import { useFavourites } from '../../hooks/useFavourites.js'
import { server } from '../../mocks/server.js'
import YourLists from '../account/YourLists.jsx'

const API = 'http://localhost:8000'
const row = (id, name, price, added, extra = {}) => ({
  id: id * 10,
  added_at: added,
  listing: { id, name, category: null, zone: null, price_amount: price, effective_price: price, was_price: null, main_photo: null, photos: [], avg_rating: null, review_count: 0, has_variants: false, ...extra },
})
const KENTE = row(1, 'Kente Cloth', '120.00', '2026-10-28T09:20:00Z')
const SHEA = row(2, 'Shea Butter', '15.00', '2026-10-20T09:20:00Z')
const SHOES = row(3, 'Adinkra Sandals', '80.00', '2026-10-10T09:20:00Z', { has_variants: true })
const customer = { fullName: 'Ama Boateng', accountType: 'customer', id: 1 }

function wishlistServer(rows) {
  const state = { rows: [...rows], deleted: [], posted: [] }
  server.use(
    http.get(`${API}/api/wishlist/`, () => HttpResponse.json(state.rows)),
    http.delete(`${API}/api/wishlist/:id/`, ({ params }) => {
      state.deleted.push(Number(params.id))
      state.rows = state.rows.filter((r) => r.listing.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/api/wishlist/`, async ({ request }) => {
      const body = await request.json()
      state.posted.push(body.listing)
      state.rows = [row(body.listing, 'Saved', '9.00', '2026-10-29T09:00:00Z'), ...state.rows]
      return HttpResponse.json(state.rows[0], { status: 201 })
    }),
  )
  return state
}

function renderLists(ui = <YourLists user={customer} />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
}
const names = () => screen.getAllByTestId('list-item-name').map((n) => n.textContent)

describe('YourLists', () => {
  it('test_lists_server_items_newest_first', async () => {
    wishlistServer([KENTE, SHEA, SHOES])
    renderLists()
    await screen.findByText('Kente Cloth')
    expect(names()).toEqual(['Kente Cloth', 'Shea Butter', 'Adinkra Sandals'])
    expect(screen.getByText('Shopping List')).toBeInTheDocument()
    expect(screen.getByText('Private')).toBeInTheDocument()
    expect(screen.getByText('Item added 28 Oct 2026')).toBeInTheDocument()
  })

  it('test_remove_calls_delete_and_refetches', async () => {
    const state = wishlistServer([KENTE, SHEA])
    renderLists()
    await screen.findByText('Kente Cloth')
    fireEvent.click(within(screen.getAllByTestId('list-item')[0]).getByRole('button', { name: /Remove/ }))
    await waitFor(() => expect(screen.queryByText('Kente Cloth')).not.toBeInTheDocument())
    expect(state.deleted).toEqual([1])
    expect(screen.getByText('Shea Butter')).toBeInTheDocument()
  })

  it('test_add_to_cart_posts_for_a_simple_product_and_links_to_the_page_for_variants', async () => {
    wishlistServer([KENTE, SHOES])
    const posted = []
    server.use(http.post(`${API}/api/cart/items/`, async ({ request }) => {
      posted.push(await request.json())
      return HttpResponse.json({ id: 5 }, { status: 201 })
    }))
    renderLists()
    await screen.findByText('Kente Cloth')
    const items = screen.getAllByTestId('list-item')
    fireEvent.click(within(items[0]).getByRole('button', { name: /Add to cart/ }))
    await waitFor(() => expect(posted).toEqual([{ listing: 1, quantity: 1 }]))
    expect(await within(items[0]).findByText('Added to your cart.')).toBeInTheDocument()
    const choose = within(items[1]).getByRole('link', { name: /Choose options/ })
    expect(choose).toHaveAttribute('href', '/business/3')
    expect(within(items[1]).queryByRole('button', { name: /Add to cart/ })).not.toBeInTheDocument()
  })

  it('test_adding_to_the_cart_refreshes_the_cart_and_the_guard', async () => {
    wishlistServer([KENTE])
    let cartReads = 0
    let guardReads = 0
    server.use(
      http.post(`${API}/api/cart/items/`, () => HttpResponse.json({ id: 5 }, { status: 201 })),
      http.get(`${API}/api/cart/`, () => { cartReads += 1; return HttpResponse.json({ id: 1, items: [], total: '0.00' }) }),
      http.get(`${API}/api/cart/guard/`, () => { guardReads += 1; return HttpResponse.json({ active: false, limits: {}, checkout: { any: null, door_to_door: null } }) }),
    )
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // The badge and the guard are mounted elsewhere in the app; observe both keys here.
    const { useCart } = await import('../../hooks/useCart.js')
    const { useCartGuard } = await import('../../hooks/useCartGuard.js')
    function Watchers() { useCart(true); useCartGuard(null, { enabled: true }); return null }
    render(<QueryClientProvider client={qc}><MemoryRouter><Watchers /><YourLists user={customer} /></MemoryRouter></QueryClientProvider>)
    await screen.findByText('Kente Cloth')
    await waitFor(() => expect(cartReads).toBe(1))
    await waitFor(() => expect(guardReads).toBe(1))
    fireEvent.click(screen.getByRole('button', { name: /Add to cart/ }))
    await screen.findByText('Added to your cart.')
    await waitFor(() => expect(cartReads).toBe(2))
    await waitFor(() => expect(guardReads).toBe(2))
  })

  it('shows the server refusal when adding to the cart fails', async () => {
    wishlistServer([KENTE])
    server.use(http.post(`${API}/api/cart/items/`, () => HttpResponse.json({ detail: 'Your delivery can include up to 4 shops. Remove one to add this.', code: 'shop_limit' }, { status: 400 })))
    renderLists()
    await screen.findByText('Kente Cloth')
    fireEvent.click(screen.getByRole('button', { name: /Add to cart/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your delivery can include up to 4 shops. Remove one to add this.')
  })

  it('test_search_and_sort_work_on_the_loaded_items', async () => {
    wishlistServer([KENTE, SHEA, SHOES])
    renderLists()
    await screen.findByText('Kente Cloth')
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'name' } })
    expect(names()).toEqual(['Adinkra Sandals', 'Kente Cloth', 'Shea Butter'])
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'price' } })
    expect(names()).toEqual(['Shea Butter', 'Adinkra Sandals', 'Kente Cloth'])
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'recent' } })
    expect(names()).toEqual(['Kente Cloth', 'Shea Butter', 'Adinkra Sandals'])
    fireEvent.change(screen.getByLabelText('Search this list'), { target: { value: 'shea' } })
    expect(names()).toEqual(['Shea Butter'])
    fireEvent.change(screen.getByLabelText('Search this list'), { target: { value: 'zzz' } })
    expect(screen.getByText('Nothing in this list matches your search.')).toBeInTheDocument()
  })

  it('has a grid and list view toggle', async () => {
    wishlistServer([KENTE])
    renderLists()
    await screen.findByText('Kente Cloth')
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Kente Cloth')).toBeInTheDocument()
  })

  it('test_empty_state', async () => {
    wishlistServer([])
    renderLists()
    expect(await screen.findByText('Nothing saved yet — tap the heart on any item.')).toBeInTheDocument()
  })

  it('test_no_multi_list_or_registry_controls', async () => {
    wishlistServer([KENTE])
    renderLists()
    await screen.findByText('Kente Cloth')
    expect(screen.queryByText(/create a list|new list|invite|gift finder|registry|friends/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })
})

describe('hearts on cards', () => {
  const item = { id: 7, name: 'Palm Oil', category: { icon: '🛢️', label: 'Food' }, price_amount: '30.00', photos: [], avg_rating: null, review_count: 0 }
  function Harness({ user }) {
    const { favourites, toggleFav, loaded, failedId } = useFavourites(user)
    return <><span data-testid="loaded">{String(loaded)}</span><Card item={item} accentColor="#C9A227" user={user} favourites={favourites} onFavourite={toggleFav} favFailed={failedId === item.id} currency="GHS" /></>
  }
  const heart = () => screen.getByRole('button', { name: /Your Lists|Save/ })

  it('test_heart_on_a_card_adds_and_removes_through_the_api_when_signed_in', async () => {
    const state = wishlistServer([])
    renderLists(<Harness user={customer} />)
    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'))
    expect(heart()).toHaveTextContent('🤍')
    fireEvent.click(heart())
    await waitFor(() => expect(heart()).toHaveTextContent('❤️'))
    expect(state.posted).toEqual([7])
    fireEvent.click(heart())
    await waitFor(() => expect(heart()).toHaveTextContent('🤍'))
    expect(state.deleted).toEqual([7])
  })

  it('shows a saved item as a filled heart once the list has loaded', async () => {
    wishlistServer([row(7, 'Palm Oil', '30.00', '2026-10-28T09:20:00Z')])
    renderLists(<Harness user={customer} />)
    await waitFor(() => expect(heart()).toHaveTextContent('❤️'))
  })

  it('test_a_failed_first_read_does_not_leave_the_hearts_inert_a_tap_retries', async () => {
    let reads = 0
    server.use(http.get(`${API}/api/wishlist/`, () => { reads += 1; return reads === 1 ? new HttpResponse(null, { status: 500 }) : HttpResponse.json([]) }))
    renderLists(<Harness user={customer} />)
    await waitFor(() => expect(reads).toBe(1))
    await waitFor(() => expect(heart()).toBeInTheDocument())
    fireEvent.click(heart())
    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'))
    expect(reads).toBe(2)
  })

  it('test_a_failed_toggle_is_shown_on_the_heart_and_cleared_by_the_next_try', async () => {
    const state = wishlistServer([])
    let fail = true
    server.use(http.post(`${API}/api/wishlist/`, async ({ request }) => {
      const body = await request.json()
      if (fail) return HttpResponse.json({ detail: 'nope' }, { status: 400 })
      state.posted.push(body.listing)
      state.rows = [row(body.listing, 'Saved', '9.00', '2026-10-29T09:00:00Z')]
      return HttpResponse.json(state.rows[0], { status: 201 })
    }))
    renderLists(<Harness user={customer} />)
    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'))
    fireEvent.click(heart())
    await waitFor(() => expect(heart()).toHaveAttribute('title', expect.stringMatching(/couldn.t update Your Lists/i)))
    expect(screen.getByRole('status')).toHaveTextContent(/couldn.t update Your Lists/i)
    expect(heart()).toHaveTextContent('🤍')
    fail = false
    fireEvent.click(heart())
    await waitFor(() => expect(heart()).toHaveTextContent('❤️'))
    expect(heart()).not.toHaveAttribute('title')
  })

  it('test_a_double_tap_adds_once', async () => {
    const state = wishlistServer([])
    renderLists(<Harness user={customer} />)
    await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('true'))
    fireEvent.click(heart())
    fireEvent.click(heart())
    await waitFor(() => expect(heart()).toHaveTextContent('❤️'))
    expect(state.posted).toEqual([7])
  })

  it('test_signed_out_heart_keeps_the_local_behaviour', async () => {
    let wishlistCalls = 0
    server.use(http.get(`${API}/api/wishlist/`, () => { wishlistCalls += 1; return HttpResponse.json([]) }))
    renderLists(<Harness user={null} />)
    fireEvent.click(heart())
    expect(heart()).toHaveTextContent('❤️')
    fireEvent.click(heart())
    expect(heart()).toHaveTextContent('🤍')
    expect(wishlistCalls).toBe(0)
  })
})
