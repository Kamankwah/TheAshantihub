import { describe, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../mocks/server.js'
import ProductCarousel, { AlsoViewedCarousel } from '../shop/ProductCarousel.jsx'

const API = 'http://localhost:8000'
const card = (id, name, extra = {}) => ({
  id, name, category: { id: 30, label: 'Fabrics', icon: '🧵', kind: 'product' }, zone: { id: 2, name: 'Adum' },
  price_amount: '90.00', effective_price: '90.00', was_price: null, sale_price: null, main_photo: null, photos: [],
  avg_rating: null, review_count: 0, has_variants: false, ...extra,
})
const items = (n) => Array.from({ length: n }, (_, i) => card(100 + i, `Item ${i + 1}`))

function withClient(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('ProductCarousel', () => {
  test('test_heading_says_customers_also_viewed_only_for_co_viewed_basis', async () => {
    server.use(http.get(`${API}/api/listings/12/also-viewed/`, ({ request }) => {
      expect(new URL(request.url).searchParams.get('limit')).toBe('12')
      return HttpResponse.json({ basis: 'co_viewed', results: [card(1, 'Adinkra Scarf')] })
    }))
    withClient(<AlsoViewedCarousel listingId={12} onOpen={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'Customers also viewed' })).toBeInTheDocument()
    expect(screen.queryByText('More in this category')).toBeNull()
  })

  test('test_same_category_basis_uses_the_honest_heading', async () => {
    server.use(http.get(`${API}/api/listings/12/also-viewed/`, () => HttpResponse.json({ basis: 'same_category', results: [card(1, 'Adinkra Scarf')] })))
    withClient(<AlsoViewedCarousel listingId={12} onOpen={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'More in this category' })).toBeInTheDocument()
    expect(screen.queryByText('Customers also viewed')).toBeNull()
  })

  test('test_sponsored_label_only_when_sponsored', () => {
    const { rerender } = render(<ProductCarousel title="Sponsored products" items={items(3)} sponsored onOpen={vi.fn()} />)
    expect(screen.getByText('Sponsored')).toBeInTheDocument()
    rerender(<ProductCarousel title="More in this category" items={items(3)} onOpen={vi.fn()} />)
    expect(screen.queryByText('Sponsored')).toBeNull()
  })

  test('test_hides_when_empty', async () => {
    const { container } = render(<ProductCarousel title="Sponsored products" items={[]} sponsored onOpen={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    server.use(http.get(`${API}/api/listings/12/also-viewed/`, () => HttpResponse.json({ basis: 'same_category', results: [] })))
    const other = withClient(<AlsoViewedCarousel listingId={12} onOpen={vi.fn()} />)
    await new Promise((r) => setTimeout(r, 50))
    expect(other.container).toBeEmptyDOMElement()
  })

  test('test_page_counter_and_arrows_move_pages', () => {
    render(<ProductCarousel title="More in this category" items={items(13)} pageSize={5} onOpen={vi.fn()} />)
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    const prev = screen.getByRole('button', { name: 'Previous page' })
    const next = screen.getByRole('button', { name: 'Next page' })
    expect(prev).toBeDisabled()
    fireEvent.click(next)
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
    fireEvent.click(next)
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
    expect(next).toBeDisabled()
    fireEvent.click(prev)
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  })

  test('test_one_page_needs_no_counter_or_arrows', () => {
    render(<ProductCarousel title="More in this category" items={items(4)} pageSize={5} onOpen={vi.fn()} />)
    expect(screen.queryByText(/^Page /)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull()
  })

  test('test_a_tile_opens_its_listing_and_hides_a_rating_it_does_not_have', () => {
    const onOpen = vi.fn()
    render(<ProductCarousel title="More in this category" items={[card(7, 'Kente Bag', { was_price: '120.00', effective_price: '90.00' }), card(8, 'Smock', { avg_rating: 4, review_count: 5 })]} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /Kente Bag/ }))
    expect(onOpen).toHaveBeenCalledWith(7)
    const bag = screen.getByRole('button', { name: /Kente Bag/ })
    expect(bag).not.toHaveTextContent(/out of 5/)
    expect(bag).toHaveTextContent('Was GHS 120.00')
    expect(screen.getByRole('button', { name: /Smock/ })).toHaveTextContent('Rated 4.0 out of 5')
  })

  test('test_a_tile_with_options_shows_the_cheapest_option_after_from', () => {
    const variants = [{ id: 1, effective_price: '150.00', available: true }, { id: 2, effective_price: '95.00', available: true }]
    render(<ProductCarousel title="More" items={[card(1, 'Stole', { has_variants: true, effective_price: '150.00', variants })]} onOpen={vi.fn()} />)
    expect(screen.getByText('From')).toBeInTheDocument()
    expect(screen.getByText('GHS 95.00')).toBeInTheDocument()
  })

  test('test_a_sold_out_option_is_not_the_from_price_and_all_sold_out_falls_back_to_the_listing_price', () => {
    const some = [{ id: 1, effective_price: '40.00', stock_quantity: 0 }, { id: 2, effective_price: '95.00', stock_quantity: 3 }]
    const { unmount } = render(<ProductCarousel title="More" items={[card(1, 'Stole', { has_variants: true, effective_price: '150.00', variants: some })]} onOpen={vi.fn()} />)
    expect(screen.getByText('GHS 95.00')).toBeInTheDocument()
    expect(screen.queryByText('GHS 40.00')).not.toBeInTheDocument()
    unmount()
    const none = [{ id: 1, effective_price: '40.00', stock_quantity: 0 }, { id: 2, effective_price: '60.00', available: false }]
    render(<ProductCarousel title="More" items={[card(1, 'Stole', { has_variants: true, effective_price: '150.00', variants: none })]} onOpen={vi.fn()} />)
    expect(screen.getByText('GHS 150.00')).toBeInTheDocument()
  })
})
